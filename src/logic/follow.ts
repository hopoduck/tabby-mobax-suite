export interface FollowInput {
  pinned: boolean;
  reportedCwd: string | null;
  currentPath: string;
}

/**
 * Decide where the SFTP panel should navigate given a freshly reported cwd.
 * Returns the target path, or null to stay put.
 */
export function nextSftpPath(input: FollowInput): string | null {
  const { pinned, reportedCwd, currentPath } = input;
  if (pinned) {
    return null;
  }
  if (!reportedCwd || !reportedCwd.startsWith('/')) {
    return null;
  }
  if (reportedCwd === currentPath) {
    return null;
  }
  return reportedCwd;
}

export function togglePin(pinned: boolean): boolean {
  return !pinned;
}
