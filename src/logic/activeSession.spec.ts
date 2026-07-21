import { describe, it, expect } from 'vitest';
import {
  focusedLeaf,
  activeScopeKey,
  isSSHLeaf,
  resolveSSHBinding,
  sidebarTabContext,
  tmuxTopmostTab,
} from './activeSession';

describe('focusedLeaf', () => {
  it('unwraps a split tab via getFocusedTab', () => {
    const leaf = { id: 'leaf' };
    const split = { getFocusedTab: () => leaf };
    expect(focusedLeaf(split)).toBe(leaf);
  });

  it('returns the tab itself when it is not a split', () => {
    const tab = { id: 'plain' };
    expect(focusedLeaf(tab)).toBe(tab);
  });

  it('is null-safe', () => {
    expect(focusedLeaf(null)).toBeNull();
    expect(focusedLeaf({ getFocusedTab: () => null })).toBeNull();
  });
});

describe('activeScopeKey', () => {
  it('returns profile.id from the focused leaf (saved profile — old activeProfileId behavior)', () => {
    const leaf = { profile: { id: 'web' }, session: { open: true } };
    expect(activeScopeKey(leaf)).toBe('web');
  });

  it('unwraps a split tab first', () => {
    const leaf = { profile: { id: 'db' } };
    expect(activeScopeKey({ getFocusedTab: () => leaf })).toBe('db');
  });

  it('prefers profile.id over profile.name when both exist', () => {
    const leaf = { profile: { id: 'web', name: 'ignored' } };
    expect(activeScopeKey(leaf)).toBe('web');
  });

  it('falls back to quick:<name> for a quick-connect leaf (no profile.id)', () => {
    const leaf = { profile: { name: 'bom-bd03.kt.com' } };
    expect(activeScopeKey(leaf)).toBe('quick:bom-bd03.kt.com');
  });

  it('trims the name and treats blank names as global', () => {
    expect(activeScopeKey({ profile: { name: '  dev-a  ' } })).toBe('quick:dev-a');
    expect(activeScopeKey({ profile: { name: '   ' } })).toBeNull();
    expect(activeScopeKey({ profile: { name: '' } })).toBeNull();
  });

  it('returns null when there is no profile or no leaf', () => {
    expect(activeScopeKey({ session: { open: true } })).toBeNull();
    expect(activeScopeKey({ profile: {} })).toBeNull();
    expect(activeScopeKey(null)).toBeNull();
    expect(activeScopeKey({ getFocusedTab: () => null })).toBeNull();
  });
});

describe('isSSHLeaf', () => {
  it('is true when the leaf exposes an sshSession', () => {
    expect(isSSHLeaf({ sshSession: { id: 'ssh' } })).toBe(true);
  });

  it('is true even when the shell is not open yet (still connecting)', () => {
    expect(isSSHLeaf({ sshSession: { id: 'ssh' }, session: { open: false } })).toBe(true);
  });

  it('is false for a non-SSH leaf or null', () => {
    expect(isSSHLeaf({})).toBe(false);
    expect(isSSHLeaf({ session: { open: true } })).toBe(false);
    expect(isSSHLeaf(null)).toBe(false);
  });
});

describe('resolveSSHBinding', () => {
  it('returns the binding for an SSH leaf with an open shell session', () => {
    const sshSession = { id: 'ssh' };
    const session = { open: true };
    expect(resolveSSHBinding({ sshSession, session })).toEqual({
      sshSession,
      shellSession: session,
    });
  });

  it('returns null when there is no ssh session', () => {
    expect(resolveSSHBinding({ sshSession: null, session: { open: true } })).toBeNull();
  });

  it('returns null when the shell session is not open', () => {
    expect(resolveSSHBinding({ sshSession: { id: 'ssh' }, session: { open: false } })).toBeNull();
    expect(resolveSSHBinding({ sshSession: { id: 'ssh' }, session: null })).toBeNull();
  });

  it('returns null for a null leaf', () => {
    expect(resolveSSHBinding(null)).toBeNull();
  });
});

describe('tmuxTopmostTab', () => {
  it('returns the hidden topmostTab from a tmux session tab', () => {
    const sshTab = { sshSession: { id: 'ssh' }, session: { open: true } };
    const passedTab: unknown[] = [];
    const tmuxTab = {
      tmuxService: {
        findContextForTab: (tab: unknown) => {
          passedTab.push(tab);
          return { topmostTab: sshTab };
        },
      },
    };
    const result = tmuxTopmostTab(tmuxTab);
    expect(result).toBe(sshTab);
    // Called with the tmux tab itself (the lookup key), not the focused leaf.
    expect(passedTab).toEqual([tmuxTab]);
  });

  it('feeds resolveSSHBinding so SFTP can bind through tmux mode', () => {
    const sshSession = { id: 'ssh' };
    const session = { open: true };
    const tmuxTab = {
      tmuxService: { findContextForTab: () => ({ topmostTab: { sshSession, session } }) },
    };
    expect(resolveSSHBinding(tmuxTopmostTab(tmuxTab) as never)).toEqual({
      sshSession,
      shellSession: session,
    });
  });

  it('returns null for a non-tmux tab (no tmuxService)', () => {
    expect(tmuxTopmostTab({ sshSession: { id: 'ssh' } })).toBeNull();
    expect(tmuxTopmostTab(null)).toBeNull();
    expect(tmuxTopmostTab({})).toBeNull();
  });

  it('degrades to null when tabby-tmux internals are shaped unexpectedly', () => {
    // findContextForTab missing / not a function
    expect(tmuxTopmostTab({ tmuxService: {} })).toBeNull();
    expect(tmuxTopmostTab({ tmuxService: { findContextForTab: 42 } })).toBeNull();
    // context without a topmostTab
    expect(tmuxTopmostTab({ tmuxService: { findContextForTab: () => ({}) } })).toBeNull();
    expect(tmuxTopmostTab({ tmuxService: { findContextForTab: () => null } })).toBeNull();
  });
});

describe('sidebarTabContext', () => {
  it('keys an SSH tab on its SSH leaf and marks it SSH', () => {
    const leaf = { sshSession: { id: 'ssh' }, session: { open: true } };
    expect(sidebarTabContext(leaf)).toEqual({ key: leaf, isSSH: true });
  });

  it('unwraps a split tab and keys on the focused SSH leaf', () => {
    const leaf = { sshSession: { id: 'ssh' }, session: { open: true } };
    const split = { getFocusedTab: () => leaf };
    expect(sidebarTabContext(split)).toEqual({ key: leaf, isSSH: true });
  });

  it('keys a tmux control-mode tab on the hidden topmost SSH leaf (shared with the SSH tab)', () => {
    const sshLeaf = { sshSession: { id: 'ssh' }, session: { open: true } };
    // tmux tab: its own focused leaf is a tmux pane (no sshSession); the SSH tab survives as
    // the topmost tab, whose focused leaf is the SSH leaf.
    const tmuxTab = {
      getFocusedTab: () => ({ id: 'tmux-pane' }),
      tmuxService: { findContextForTab: () => ({ topmostTab: sshLeaf }) },
    };
    expect(sidebarTabContext(tmuxTab)).toEqual({ key: sshLeaf, isSSH: true });
  });

  it('keys a plain non-SSH tab on its own leaf and marks it non-SSH', () => {
    const leaf = { session: { open: true } };
    expect(sidebarTabContext(leaf)).toEqual({ key: leaf, isSSH: false });
  });

  it('reads a still-connecting SSH leaf (no sshSession yet) as non-SSH, keyed on the leaf', () => {
    const leaf = { session: null };
    expect(sidebarTabContext(leaf)).toEqual({ key: leaf, isSSH: false });
  });

  it('returns a null key when no leaf is resolvable', () => {
    expect(sidebarTabContext(null)).toEqual({ key: null, isSSH: false });
    expect(sidebarTabContext({ getFocusedTab: () => null })).toEqual({ key: null, isSSH: false });
  });
});
