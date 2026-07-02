import { chmodSync, mkdtempSync, rmSync, watch as fsWatch, FSWatcher } from 'fs';
import { tmpdir } from 'os';
import { join as joinPath, posix as posixPath } from 'path';
import { Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { FileDownload, FileUpload, NotificationsService, PlatformService } from 'tabby-core';
import { SFTPSession, SFTPFile } from 'tabby-ssh';
import { createSerialRunner } from './logic/serialRunner';
import { CancelledError } from './transferWrap';
import { FsFileDownload, FsFileUpload } from './fsTransfer';
import { TransferService } from './services/transfer.service';
import { spawn } from 'child_process';
import { isBinaryName } from './logic/openWith';

const WATCH_START_DELAY_MS = 1000; // skip the editor's initial write burst on open
const SAVE_DEBOUNCE_MS = 1000;

function rmDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows file lock — leave leftovers to OS temp cleanup.
  }
}

/**
 * Read a remote file's LIVE permission bits.
 *
 * `SFTPSession.stat()` is unusable for this: russh's stat copies the metadata via
 * `Object.assign({}, md)`, which drops `permissions` (a non-enumerable getter), so `.mode`
 * comes back as 0. The directory-listing path (`readdir`) instead reads `md.permissions`
 * explicitly, so it carries the real mode. We therefore re-list the parent directory and pick
 * out our entry to get a fresh, correct mode (the panel's own `item.mode` can be stale if the
 * file was chmod'd elsewhere after the listing was cached).
 *
 * Returns the permission bits (`& 0o7777`), or null if the file/listing is unavailable.
 */
async function liveMode(sftp: SFTPSession, fullPath: string): Promise<number | null> {
  const parent = posixPath.dirname(fullPath);
  const name = posixPath.basename(fullPath);
  const entries = await sftp.readdir(parent);
  const found = entries.find((e) => e.name === name);
  return found ? found.mode & 0o7777 : null;
}

export interface EditLocallyOptions {
  /** Editor executable path from settings; ''/undefined = notepad fallback (Windows only). */
  editorPath?: string;
  /** Force the OS file-association open (context-menu "연결 프로그램으로 열기"). */
  forceOs?: boolean;
}

/**
 * Open the downloaded temp copy. MobaXterm model: known-binary extensions (and explicit
 * forceOs) go to the OS file association; everything else opens in the configured text editor
 * so the Windows "choose an app" dialog never appears. On a non-Windows host with no editor
 * configured there is no notepad to fall back to, so the OS association keeps handling it.
 */
function openLocalFile(
  localPath: string,
  name: string,
  platform: PlatformService,
  notifications: NotificationsService,
  opts?: EditLocallyOptions,
): void {
  const editorPath = (opts?.editorPath ?? '').trim();
  if (opts?.forceOs || isBinaryName(name) || (!editorPath && process.platform !== 'win32')) {
    platform.openPath(localPath);
    return;
  }
  const editor = editorPath || 'notepad.exe';
  try {
    const child = spawn(editor, [localPath], { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      notifications.error(`에디터 실행 실패: ${editor}`, 'OS 기본 프로그램으로 엽니다.');
      platform.openPath(localPath);
    });
    child.unref();
  } catch (err) {
    notifications.error(`에디터 실행 실패: ${editor}`, String((err as Error)?.message ?? err));
    platform.openPath(localPath);
  }
}

/**
 * Download a remote file to a temp dir, open it (configured text editor for text names, OS
 * association for binaries / forceOs — see openLocalFile), and re-upload it whenever the local
 * copy is saved (MobaXterm "Edit locally"). Watches the temp *directory* (filtered by filename)
 * so atomic-save editors (write-temp-then-rename) keep being tracked.
 */
export async function editLocally(
  item: SFTPFile,
  sftp: SFTPSession,
  platform: PlatformService,
  notifications: NotificationsService,
  transfer: TransferService,
  opts?: EditLocallyOptions,
): Promise<void> {
  const dir = mkdtempSync(joinPath(tmpdir(), 'tabby-mobax-edit-'));
  const localPath = joinPath(dir, item.name);
  const oct = (m: number): string => (m & 0o7777).toString(8);

  // 1. Download to temp (no save dialog). Surface it in the bottom progress strip with cancel — but
  // only when no other transfer already owns the strip, so we don't clobber its state / byte counts.
  const showProgress = !transfer.state.active;
  const sink = showProgress ? transfer : undefined;
  if (showProgress) {
    transfer.start('download', 1);
    transfer.setCurrent(item.name, item.size);
  }
  const dl = new FsFileDownload(item.name, item.mode, item.size, localPath, sink);
  try {
    await sftp.download(item.fullPath, dl as unknown as FileDownload);
    await dl.whenClosed();
  } catch (err) {
    rmDir(dir);
    if (showProgress) {
      transfer.finish();
    }
    if (err instanceof CancelledError) {
      notifications.notice(`열기 취소됨: ${item.name}`);
      return;
    }
    await platform.showMessageBox({
      type: 'error',
      message: '열기 실패',
      detail: String((err as Error)?.message ?? err),
      buttons: ['확인'],
      defaultId: 0,
    });
    return;
  }
  if (showProgress) {
    transfer.finish();
  }

  chmodSync(localPath, 0o700);
  openLocalFile(localPath, item.name, platform, notifications, opts);

  // 2. Watch + re-upload.
  let stopped = false;
  let watcher: FSWatcher | null = null;
  const stop$ = new Subject<void>();
  const changes$ = new Subject<void>();

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    stop$.next();
    stop$.complete();
    changes$.complete();
    rmDir(dir);
  };

  // The SFTP `closed$` does not fire on every teardown path (e.g. a multiplexed connection
  // surviving a tab close), so the watcher can outlive the transport. Detect a dead session
  // from the upload error and stop syncing cleanly instead of erroring on every save.
  const isSessionClosed = (err: unknown): boolean => {
    const msg = String((err as Error)?.message ?? err).toLowerCase();
    return msg.includes('closed') || msg.includes('not connected') || msg.includes('disconnect');
  };

  const upload = createSerialRunner(async () => {
    // Read the file's CURRENT live mode right before the (destructive) upload, via a fresh
    // re-listing (NOT stat — that returns 0 in this russh). Falls back to the open-time snapshot
    // only if the re-listing fails, so a permission changed externally is still preserved.
    let perm = item.mode & 0o7777;
    try {
      const live = await liveMode(sftp, item.fullPath);
      if (live !== null) {
        perm = live;
      }
    } catch {
      // re-listing failed (file gone / session dead) — keep the open-time fallback.
    }

    const up = new FsFileUpload(item.name, perm, localPath);
    try {
      await sftp.upload(item.fullPath, up as unknown as FileUpload);
    } catch (err) {
      if (isSessionClosed(err)) {
        notifications.notice(`세션이 종료되어 '열기' 동기화를 중단합니다: ${item.name}`);
        stop();
      } else {
        notifications.error(`업로드 실패: ${item.name}`, String((err as Error)?.message ?? err));
      }
      return;
    }
    // Tabby's upload recreates the file (write temp + rename over original), so the server's
    // umask resets the mode. Restore the live permission bits captured above.
    try {
      await sftp.chmod(item.fullPath, perm);
    } catch (err) {
      notifications.error(
        `권한 복원 실패 (${oct(perm)}): ${item.name}`,
        String((err as Error)?.message ?? err),
      );
    }
    notifications.notice(`저장됨: ${item.name} (권한 ${oct(perm)})`);
  });

  changes$.pipe(debounceTime(SAVE_DEBOUNCE_MS), takeUntil(stop$)).subscribe(() => upload.trigger());

  sftp.closed$.pipe(takeUntil(stop$)).subscribe(() => stop());

  setTimeout(() => {
    if (stopped) {
      return;
    }
    try {
      watcher = fsWatch(dir, (_event, filename) => {
        if (filename && filename.toString() === item.name) {
          changes$.next();
        }
      });
      watcher.on('error', () => stop());
    } catch {
      stop();
    }
  }, WATCH_START_DELAY_MS);
}
