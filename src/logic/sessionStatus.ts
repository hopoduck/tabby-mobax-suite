// Pure, dependency-free logic for the "connected" dots shown on each session row.
// Counts how many live (session.open === true) terminal panes each saved profile currently has
// open, so the Sessions list can render up to MAX_DOTS dots per profile. Duck-typed (no Tabby
// imports) so it stays unit-testable without Electron, per the project's test policy.

/** Max number of dots rendered per profile row; extra live connections are not shown. */
export const MAX_DOTS = 3;

export interface CountableSession {
  open?: boolean;
}

/** A leaf (terminal) tab: carries the profile that launched it and its live session, if any. */
export interface CountableLeaf {
  profile?: { id?: string } | null;
  session?: CountableSession | null;
}

/** A top-level tab: a SplitTabComponent exposes getAllTabs(); a raw tab is its own single leaf. */
export interface CountableTopTab {
  getAllTabs?: () => unknown[];
}

/** Flatten a top-level tab into its leaf tabs (split panes), or itself when not a split. */
export function leavesOf(tab: unknown): unknown[] {
  const getAll = (tab as CountableTopTab | null)?.getAllTabs;
  if (typeof getAll === 'function') {
    const all = getAll.call(tab);
    return Array.isArray(all) ? all : [];
  }
  return tab == null ? [] : [tab];
}

/** True when a leaf is a terminal pane whose session is currently connected. */
function isLiveLeaf(leaf: CountableLeaf | null): boolean {
  return !!leaf && leaf.session?.open === true;
}

/**
 * Count live connections per profile id across all top-level tabs. A profile that has been
 * launched N times (and is still connected each time) maps to N; profiles with no live pane are
 * absent from the map. Leaves with no profile id (e.g. built-in templates) are ignored.
 */
export function countLiveByProfile(tabs: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tab of tabs ?? []) {
    for (const raw of leavesOf(tab)) {
      const leaf = raw as CountableLeaf | null;
      if (!isLiveLeaf(leaf)) {
        continue;
      }
      const id = leaf?.profile?.id;
      if (!id) {
        continue;
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/** Clamp a raw live-connection count to the number of dots to render (0..max). */
export function dotCount(liveCount: number, max = MAX_DOTS): number {
  if (!Number.isFinite(liveCount) || liveCount <= 0) {
    return 0;
  }
  return Math.min(Math.floor(liveCount), max);
}
