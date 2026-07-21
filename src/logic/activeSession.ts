import { QUICK_SCOPE_PREFIX } from './scopeKey';

export interface ShellSessionLike {
  open?: boolean;
}

export interface SSHLeafLike {
  sshSession?: unknown;
  session?: ShellSessionLike | null;
}

export interface FocusableLike {
  getFocusedTab?: () => unknown;
}

/**
 * Shape of a tabby-tmux control-mode tab (`TmuxSessionTabComponent`). It extends
 * `SplitTabComponent`, so its `getFocusedTab()` yields a tmux *pane* tab — never the SSH tab —
 * which is why `resolveSSHBinding` comes up empty in tmux mode. The original SSH tab survives
 * hidden as the tmux context's `topmostTab`, reachable only via the tab's injected (private,
 * but runtime-present) `tmuxService.findContextForTab`.
 */
export interface TmuxSessionTabLike {
  tmuxService?: {
    findContextForTab?: (tab: unknown) => { topmostTab?: unknown } | null | undefined;
  };
}

/**
 * When `activeTab` is a tabby-tmux control-mode tab, return the hidden original SSH tab
 * (`topmostTab`) so SFTP can bind to the still-live SSH session (SFTP opens its own channel,
 * independent of the shell channel tmux drives). Returns null for any non-tmux tab. Fully
 * duck-typed: if tabby-tmux renames these internals it degrades to null (SFTP falls back to
 * "No active SSH session") instead of throwing.
 */
export function tmuxTopmostTab(activeTab: unknown): unknown {
  const svc = (activeTab as TmuxSessionTabLike | null)?.tmuxService;
  const find = svc?.findContextForTab;
  if (typeof find !== 'function') {
    return null;
  }
  return find.call(svc, activeTab)?.topmostTab ?? null;
}

/** Resolve the focused leaf from a (possibly split) active tab. */
export function focusedLeaf(activeTab: unknown): unknown {
  if (!activeTab) {
    return null;
  }
  const focusable = activeTab as FocusableLike;
  if (typeof focusable.getFocusedTab === 'function') {
    return focusable.getFocusedTab() ?? null;
  }
  return activeTab;
}

/**
 * The macro scope key of the focused leaf (the same leaf MacroRunnerService sends to):
 *   - a saved-profile tab → its profile id (exactly the old activeProfileId behavior)
 *   - a quick-connect tab (profile has no id — e.g. tacs) → 'quick:' + profile.name; the
 *     tabby-quickconnect-tacs plugin writes the trailing #title (device name) into profile.name,
 *     and OSC dynamic titles only touch the tab title, never profile.name, so the key is stable
 *     for the tab's lifetime.
 *   - no profile at all → null (global macros only).
 */
export function activeScopeKey(activeTab: unknown): string | null {
  const leaf = focusedLeaf(activeTab) as { profile?: { id?: string; name?: string } } | null;
  if (leaf?.profile?.id) {
    return leaf.profile.id;
  }
  const name = leaf?.profile?.name?.trim();
  return name ? QUICK_SCOPE_PREFIX + name : null;
}

/**
 * True when the leaf is an SSH tab (duck-typed by its `sshSession`), regardless
 * of whether the shell has finished connecting. Used to decide when to surface
 * the SFTP browser; the actual SFTP binding additionally requires `open` (see
 * resolveSSHBinding).
 */
export function isSSHLeaf(leaf: SSHLeafLike | null): boolean {
  return !!leaf?.sshSession;
}

/**
 * Given a leaf already narrowed to an SSH tab (or null), return its SFTP
 * binding when the shell session is open; otherwise null.
 */
export function resolveSSHBinding(
  leaf: SSHLeafLike | null,
): { sshSession: unknown; shellSession: ShellSessionLike } | null {
  if (!leaf || !leaf.sshSession) {
    return null;
  }
  if (!leaf.session || leaf.session.open !== true) {
    return null;
  }
  return { sshSession: leaf.sshSession, shellSession: leaf.session };
}

/**
 * Per-tab context used to key the sidebar's in-memory "last inner tab" map and to pick the
 * first-time default. `key` is the identity object remembered against:
 *   - an SSH tab → its SSH leaf
 *   - a tmux control-mode tab → the hidden topmost SSH leaf (so the SSH tab and its tmux mode
 *     share one memory entry)
 *   - any other tab → the focused leaf itself
 * `key` is null only when no leaf is resolvable yet (split not laid out). `isSSH` selects the
 * first-time default (SSH → SFTP, otherwise Sessions). A just-launched SSH tab whose `sshSession`
 * isn't set yet reads as `isSSH: false` here; the component defers that case via `sessionChanged$`.
 */
export interface SidebarTabContext {
  key: object | null;
  isSSH: boolean;
}

export function sidebarTabContext(activeTab: unknown): SidebarTabContext {
  const leaf = focusedLeaf(activeTab) as SSHLeafLike | null;
  if (isSSHLeaf(leaf)) {
    return { key: leaf as object, isSSH: true };
  }
  const tmuxLeaf = focusedLeaf(tmuxTopmostTab(activeTab)) as SSHLeafLike | null;
  if (isSSHLeaf(tmuxLeaf)) {
    return { key: tmuxLeaf as object, isSSH: true };
  }
  return { key: leaf && typeof leaf === 'object' ? (leaf as object) : null, isSSH: false };
}
