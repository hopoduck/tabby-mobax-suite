import { describe, it, expect } from 'vitest';
import { parseStat, findShellPid } from './procCwd';

describe('parseStat', () => {
  it('parses a normal stat line', () => {
    const line = '4242 (bash) S 100 4242 4242 34816 4242 4194304 0 0';
    expect(parseStat(line)).toEqual({ pid: 4242, comm: 'bash', ppid: 100, ttyNr: 34816 });
  });

  it('handles comm containing spaces and parentheses', () => {
    const line = '55 (weird (proc) name) S 7 55 55 0 -1 0';
    expect(parseStat(line)).toEqual({ pid: 55, comm: 'weird (proc) name', ppid: 7, ttyNr: 0 });
  });

  it('returns null when there are no parentheses', () => {
    expect(parseStat('garbage line')).toBeNull();
  });

  it('returns null when fields after comm are missing', () => {
    expect(parseStat('5 (x) S')).toBeNull();
  });
});

describe('findShellPid', () => {
  // 100 = session sshd, 102 = our sftp-server (self, no tty)
  const base = {
    100: { ppid: 1, ttyNr: 0, comm: 'sshd' },
    102: { ppid: 100, ttyNr: 0, comm: 'sftp-server' },
  };

  it('returns the single shell sharing our session sshd', () => {
    const map = { ...base, 101: { ppid: 100, ttyNr: 34816, comm: 'bash' } };
    expect(findShellPid(map, 102)).toBe(101);
  });

  it('returns null when several shells share the connection (ambiguous)', () => {
    const map = {
      ...base,
      101: { ppid: 100, ttyNr: 34816, comm: 'bash' },
      103: { ppid: 100, ttyNr: 34817, comm: 'zsh' },
    };
    expect(findShellPid(map, 102)).toBeNull();
  });

  it('returns null when no shell has a controlling tty', () => {
    expect(findShellPid(base, 102)).toBeNull();
  });

  it('returns null when the sftp self pid is unknown', () => {
    expect(findShellPid(base, 999)).toBeNull();
  });
});
