// Pure decision logic for the sidebar rail's per-tab ON/OFF toggles. No Angular/Tabby imports
// (vitest runs it without a host). A flag is "enabled" unless it is explicitly === false, so a
// missing/undefined config (before defaults merge) reads as fully enabled.

export type InnerTabId = 'sessions' | 'sftp' | 'macros';

export interface RailTabsConfig {
  sessions: boolean;
  sftp: boolean;
  macros: boolean;
  tmux: boolean;
}

const INNER_TAB_ORDER: InnerTabId[] = ['sessions', 'sftp', 'macros'];
const RAIL_ITEMS: (keyof RailTabsConfig)[] = ['sessions', 'sftp', 'macros', 'tmux'];

/** The inner-tab ids that should render in the rail, in display order. */
export function enabledInnerTabs(tabs: Partial<RailTabsConfig> | undefined): InnerTabId[] {
  return INNER_TAB_ORDER.filter((id) => tabs?.[id] !== false);
}

/** Whether the sidebar should be mounted at all: any of the four rail items enabled. */
export function anyRailItemEnabled(tabs: Partial<RailTabsConfig> | undefined): boolean {
  return RAIL_ITEMS.some((k) => tabs?.[k] !== false);
}

/**
 * The inner tab to show: keep `current` if still enabled, else the first enabled inner tab,
 * else null (no inner tab enabled — e.g. only the tmux button is on).
 */
export function resolveActiveInnerTab(
  tabs: Partial<RailTabsConfig> | undefined,
  current: InnerTabId | null,
): InnerTabId | null {
  const enabled = enabledInnerTabs(tabs);
  if (current && enabled.includes(current)) {
    return current;
  }
  return enabled[0] ?? null;
}
