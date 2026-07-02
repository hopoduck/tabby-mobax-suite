import { describe, it, expect } from 'vitest';
import { enabledInnerTabs, anyRailItemEnabled, resolveActiveInnerTab } from './tabsConfig';

const ALL = { sessions: true, sftp: true, macros: true, tmux: true };

describe('enabledInnerTabs', () => {
  it('returns all three inner tabs in order when all enabled', () => {
    expect(enabledInnerTabs(ALL)).toEqual(['sessions', 'sftp', 'macros']);
  });
  it('filters out disabled inner tabs, preserving order', () => {
    expect(enabledInnerTabs({ ...ALL, sftp: false })).toEqual(['sessions', 'macros']);
  });
  it('ignores the tmux flag (not an inner tab)', () => {
    expect(enabledInnerTabs({ sessions: false, sftp: false, macros: false, tmux: true })).toEqual(
      [],
    );
  });
  it('treats missing config as all-enabled', () => {
    expect(enabledInnerTabs(undefined)).toEqual(['sessions', 'sftp', 'macros']);
  });
});

describe('anyRailItemEnabled', () => {
  it('is true when any of the four items is enabled', () => {
    expect(anyRailItemEnabled({ sessions: false, sftp: false, macros: false, tmux: true })).toBe(
      true,
    );
  });
  it('is false only when all four are off', () => {
    expect(anyRailItemEnabled({ sessions: false, sftp: false, macros: false, tmux: false })).toBe(
      false,
    );
  });
  it('treats undefined config as enabled', () => {
    expect(anyRailItemEnabled(undefined)).toBe(true);
  });
});

describe('resolveActiveInnerTab', () => {
  it('keeps the current tab when it is still enabled', () => {
    expect(resolveActiveInnerTab(ALL, 'sftp')).toBe('sftp');
  });
  it('falls back to the first enabled tab when current is disabled', () => {
    expect(resolveActiveInnerTab({ ...ALL, sftp: false }, 'sftp')).toBe('sessions');
  });
  it('falls back to first enabled when current is null', () => {
    expect(resolveActiveInnerTab({ ...ALL, sessions: false }, null)).toBe('sftp');
  });
  it('returns null when no inner tab is enabled', () => {
    expect(
      resolveActiveInnerTab({ sessions: false, sftp: false, macros: false, tmux: true }, 'sessions'),
    ).toBeNull();
  });
});
