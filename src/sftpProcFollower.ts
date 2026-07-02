import { Observable, Subject, timer } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { parseStat, findShellPid, ProcEntry } from './logic/procCwd';
import {
  PROC_FOLLOW_DEBOUNCE_MS,
  PROC_FOLLOW_SAFETY_POLL_MS,
  OSC_DEFER_WINDOW_MS,
} from './config';

const O_RDONLY = 0;
const DEBUG = false; // flip to true to trace resolution in devtools during QA

export interface SftpFileHandleLike {
  read(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface SftpLike {
  readlink(p: string): Promise<string>;
  open(p: string, mode: number): Promise<SftpFileHandleLike>;
}

export interface ShellLike {
  output$: Observable<string>;
}

export interface FollowerDeps {
  /** The active SFTP panel's session, or null until it has opened. */
  getSftp: () => SftpLike | null;
  /** The bound shell session (exposes terminal output). */
  shell: ShellLike;
  /** Called with an absolute path when the shell's cwd changes. */
  onCwd: (path: string) => void;
  /** Whether follow is currently paused (pinned). */
  isPinned: () => boolean;
  /** Milliseconds since the last OSC cwd report (large if never). */
  oscFreshMs: () => number;
}

/**
 * MobaXterm-style cwd follower: resolves the remote shell's pid once (via
 * /proc, anchored on the sftp-server's own /proc/self), then re-reads
 * /proc/<pid>/cwd on terminal output (debounced) plus a slow safety timer.
 * Defers to OSC whenever OSC has reported recently. All decisions live in
 * src/logic/procCwd.ts; this class only does I/O and timing.
 */
export class SftpProcFollower {
  private destroyed$ = new Subject<void>();
  private shellPid: number | null = null;
  private lastCwd: string | null = null;
  private inactive = false; // /proc unsupported on this remote
  private ticking = false;

  constructor(private deps: FollowerDeps) {}

  start(): void {
    this.deps.shell.output$
      .pipe(debounceTime(PROC_FOLLOW_DEBOUNCE_MS), takeUntil(this.destroyed$))
      .subscribe(() => void this.tick());
    timer(PROC_FOLLOW_SAFETY_POLL_MS, PROC_FOLLOW_SAFETY_POLL_MS)
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => void this.tick());
  }

  stop(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.shellPid = null;
    this.lastCwd = null;
  }

  /** Force an immediate re-read (e.g. when the user re-enables follow). */
  syncNow(): void {
    void this.tick();
  }

  private debug(msg: string): void {
    if (DEBUG) {
      console.log(`[mobax/procFollow] ${msg}`);
    }
  }

  private async readFile(sftp: SftpLike, path: string): Promise<string | null> {
    let handle: SftpFileHandleLike | null = null;
    try {
      handle = await sftp.open(path, O_RDONLY);
      const chunk = await handle.read(); // procfs stat/children fit in one read
      if (!chunk || chunk.length === 0) {
        return null;
      }
      return new TextDecoder().decode(chunk);
    } catch {
      return null;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async resolveShellPid(sftp: SftpLike): Promise<void> {
    const selfTarget = await sftp.readlink('/proc/self').catch(() => null);
    if (selfTarget === null) {
      this.inactive = true; // no /proc on this remote
      this.debug('no /proc/self → inactive');
      return;
    }
    const sftpSelfPid = Number(selfTarget.trim().split('/').pop());
    if (!Number.isInteger(sftpSelfPid)) {
      this.inactive = true;
      return;
    }
    const selfStat = await this.readFile(sftp, `/proc/${sftpSelfPid}/stat`);
    const selfInfo = selfStat ? parseStat(selfStat) : null;
    if (!selfInfo) {
      this.debug('cannot read own /proc stat (procfs read may be unsupported)');
      return; // transient; do not mark inactive (readlink-only retry next tick)
    }
    const sessionSshd = selfInfo.ppid;
    const childrenRaw = await this.readFile(
      sftp,
      `/proc/${sessionSshd}/task/${sessionSshd}/children`,
    );
    if (childrenRaw === null) {
      this.inactive = true; // no children file (CONFIG_PROC_CHILDREN off) → give up
      this.debug('no children file → inactive');
      return;
    }
    const childPids = childrenRaw
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    const procMap: Record<number, ProcEntry> = {
      [sftpSelfPid]: { ppid: selfInfo.ppid, ttyNr: selfInfo.ttyNr, comm: selfInfo.comm },
    };
    for (const pid of childPids) {
      const stat = await this.readFile(sftp, `/proc/${pid}/stat`);
      const info = stat ? parseStat(stat) : null;
      if (info) {
        procMap[pid] = { ppid: info.ppid, ttyNr: info.ttyNr, comm: info.comm };
      }
      this.debug(`  child ${pid} stat=${stat ?? 'null'}`);
    }
    this.shellPid = findShellPid(procMap, sftpSelfPid);
    this.debug(
      `self=${sftpSelfPid} sshd=${sessionSshd} children=[${childPids.join(',')}] → shellPid=${this.shellPid}`,
    );
  }

  private async tick(): Promise<void> {
    if (this.inactive || this.ticking) {
      return;
    }
    if (this.deps.isPinned()) {
      return;
    }
    if (this.deps.oscFreshMs() < OSC_DEFER_WINDOW_MS) {
      return; // OSC already handled this update
    }
    const sftp = this.deps.getSftp();
    if (!sftp) {
      return; // panel SFTP not open yet
    }
    this.ticking = true;
    try {
      if (this.shellPid === null) {
        await this.resolveShellPid(sftp);
        if (this.shellPid === null) {
          return; // unresolved/ambiguous → safe fallback
        }
      }
      let target: string;
      try {
        target = await sftp.readlink(`/proc/${this.shellPid}/cwd`);
      } catch {
        this.shellPid = null; // shell died / pid reused → re-resolve next tick
        return;
      }
      if (!target || target === this.lastCwd) {
        return;
      }
      this.lastCwd = target;
      this.deps.onCwd(target);
    } finally {
      this.ticking = false;
    }
  }
}
