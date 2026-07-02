export interface StatInfo {
  pid: number;
  comm: string;
  ppid: number;
  ttyNr: number;
}

/**
 * Parse one `/proc/<pid>/stat` line. `comm` is parenthesised and may contain
 * spaces/parentheses, so fields are read after the LAST ')'. Returns null on
 * malformed input.
 */
export function parseStat(content: string): StatInfo | null {
  const open = content.indexOf('(');
  const close = content.lastIndexOf(')');
  if (open < 0 || close < 0 || close < open) {
    return null;
  }
  const pid = Number(content.slice(0, open).trim());
  if (!Number.isInteger(pid)) {
    return null;
  }
  const comm = content.slice(open + 1, close);
  const rest = content
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // rest[0]=state, rest[1]=ppid, rest[2]=pgrp, rest[3]=session, rest[4]=tty_nr
  if (rest.length < 5) {
    return null;
  }
  const ppid = Number(rest[1]);
  const ttyNr = Number(rest[4]);
  if (!Number.isInteger(ppid) || !Number.isInteger(ttyNr)) {
    return null;
  }
  return { pid, comm, ppid, ttyNr };
}

export interface ProcEntry {
  ppid: number;
  ttyNr: number;
  comm: string;
}

/**
 * Given all readable /proc entries and our own sftp-server pid, return the pid
 * of the single interactive shell on this connection (a child of the same
 * session sshd that owns a controlling tty). Returns null if there is not
 * exactly one such shell (safe fallback for the multiplexed multi-pane case).
 */
export function findShellPid(
  procMap: Record<number, ProcEntry>,
  sftpSelfPid: number,
): number | null {
  const self = procMap[sftpSelfPid];
  if (!self) {
    return null;
  }
  const sessionSshd = self.ppid;
  const shells: number[] = [];
  for (const [pidStr, entry] of Object.entries(procMap)) {
    const pid = Number(pidStr);
    if (pid === sftpSelfPid) {
      continue;
    }
    if (entry.ppid === sessionSshd && entry.ttyNr !== 0) {
      shells.push(pid);
    }
  }
  return shells.length === 1 ? shells[0] : null;
}
