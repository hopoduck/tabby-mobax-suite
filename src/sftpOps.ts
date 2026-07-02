import { posix as posixPath } from 'path';
import { FileUpload, PlatformService } from 'tabby-core';
import { SFTPSession, SFTPFile } from 'tabby-ssh';
import { wrapDownload, ProgressSink, CancelledError } from './transferWrap';

/** POSIX path join with `/`-collapse; '' dir falls back to root. */
export function joinPath(dir: string, name: string): string {
  return posixPath.join(dir || '/', name);
}

export type DownloadOutcome = 'done' | 'cancelled' | 'skipped';

/**
 * Download a remote file via the platform save dialog. When a `sink` is given, the transfer is
 * wrapped so it reports byte progress and aborts on cancel (returning 'cancelled' instead of
 * throwing). Returns 'skipped' if the user dismissed the save dialog.
 */
export async function downloadFile(
  platform: PlatformService,
  sftp: SFTPSession,
  file: SFTPFile,
  sink?: ProgressSink,
): Promise<DownloadOutcome> {
  const fd = await platform.startDownload(file.name, file.mode, file.size);
  if (!fd) {
    return 'skipped'; // user cancelled the save dialog
  }
  const transfer = sink ? wrapDownload(fd, sink) : fd;
  try {
    await sftp.download(file.fullPath, transfer);
  } catch (err) {
    if (err instanceof CancelledError) {
      return 'cancelled';
    }
    throw err;
  }
  return 'done';
}

export async function makeDir(sftp: SFTPSession, dirPath: string, name: string): Promise<void> {
  await sftp.mkdir(joinPath(dirPath, name));
}

export async function renameEntry(
  sftp: SFTPSession,
  dirPath: string,
  oldName: string,
  newName: string,
): Promise<void> {
  await sftp.rename(joinPath(dirPath, oldName), joinPath(dirPath, newName));
}

/** Move (rename) an entry from one absolute path to another. */
export async function moveEntry(sftp: SFTPSession, from: string, to: string): Promise<void> {
  await sftp.rename(from, to);
}

export async function removeEntry(sftp: SFTPSession, file: SFTPFile): Promise<void> {
  if (file.isDirectory) {
    await sftp.rmdir(file.fullPath);
  } else {
    await sftp.unlink(file.fullPath);
  }
}

export interface RemoteWalkResult {
  dirs: SFTPFile[]; // directories INCLUDING `root`, pre-order (parent before children)
  files: SFTPFile[]; // regular files to download
  skippedSymlinks: number;
}

/**
 * Recursively list a remote directory. Returns `root` plus every sub-directory in pre-order (a parent
 * always precedes its children) and every regular file. Symlinks are skipped (no recursion through
 * them) and counted. The caller maps each entry's `fullPath` to a local path via `relativeUnder`.
 */
export async function walkRemoteDir(sftp: SFTPSession, root: SFTPFile): Promise<RemoteWalkResult> {
  const dirs: SFTPFile[] = [root];
  const files: SFTPFile[] = [];
  let skippedSymlinks = 0;
  const visit = async (dir: SFTPFile): Promise<void> => {
    const entries = await sftp.readdir(dir.fullPath);
    for (const e of entries) {
      if (e.isSymlink) {
        skippedSymlinks++;
      } else if (e.isDirectory) {
        dirs.push(e);
        await visit(e);
      } else {
        files.push(e);
      }
    }
  };
  await visit(root);
  return { dirs, files, skippedSymlinks };
}

// Re-export so the component imports a single type from tabby-ssh via ops where convenient.
export type { SFTPFile, SFTPSession };
export type { FileUpload };
