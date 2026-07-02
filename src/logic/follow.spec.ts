import { describe, it, expect } from 'vitest';
import { nextSftpPath, togglePin } from './follow';

describe('nextSftpPath', () => {
  it('returns the reported cwd when unpinned and it differs from current', () => {
    expect(nextSftpPath({ pinned: false, reportedCwd: '/home/user', currentPath: '/' })).toBe(
      '/home/user',
    );
  });

  it('returns null when pinned, even with a valid new cwd', () => {
    expect(nextSftpPath({ pinned: true, reportedCwd: '/home/user', currentPath: '/' })).toBeNull();
  });

  it('returns null when the reported cwd equals the current path', () => {
    expect(
      nextSftpPath({ pinned: false, reportedCwd: '/home/user', currentPath: '/home/user' }),
    ).toBeNull();
  });

  it('returns null for a null or empty reported cwd', () => {
    expect(nextSftpPath({ pinned: false, reportedCwd: null, currentPath: '/' })).toBeNull();
    expect(nextSftpPath({ pinned: false, reportedCwd: '', currentPath: '/' })).toBeNull();
  });

  it('ignores non-absolute paths (must start with /)', () => {
    expect(
      nextSftpPath({ pinned: false, reportedCwd: 'relative/dir', currentPath: '/' }),
    ).toBeNull();
  });
});

describe('togglePin', () => {
  it('flips the pin state', () => {
    expect(togglePin(false)).toBe(true);
    expect(togglePin(true)).toBe(false);
  });
});
