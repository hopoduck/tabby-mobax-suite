// Pure, dependency-free quick-connect scope-key helpers (no Angular/Tabby imports) so they are
// unit-testable without Electron. Mirrors the test policy in CLAUDE.md.
//
// A macro's profileId holds either a saved-profile id (e.g. "ssh:custom:web:<uuid>") or a
// quick-connect device key "quick:<device-name>". Tabby profile ids always start with the
// provider type ("ssh:", "telnet:", "local:", "serial:") and no provider is named "quick",
// so the prefix cannot collide with a real id.

import { Macro } from './macro';

export const QUICK_SCOPE_PREFIX = 'quick:';

// Type predicate (not a plain boolean): strictNullChecks is off in this repo, so callers get no
// control-flow narrowing from a boolean — the predicate narrows regardless.
export function isQuickScope(key: string | null | undefined): key is string {
  return typeof key === 'string' && key.startsWith(QUICK_SCOPE_PREFIX);
}

/** Display name for a quick scope key (strips the prefix; non-quick keys pass through). */
export function quickScopeLabel(key: string): string {
  return isQuickScope(key) ? key.slice(QUICK_SCOPE_PREFIX.length) : key;
}

/**
 * Quick-scope entries for the editor's 적용 대상 dropdown: every quick key among `candidates`
 * (the active session's scope key, the draft's current scope) plus every quick key already used
 * by an existing macro — deduped, sorted by device name. Non-quick candidates (saved-profile
 * ids, nulls) are ignored.
 */
export function quickScopeChoices(candidates: (string | null)[], macros: Macro[]): string[] {
  const keys = new Set<string>();
  for (const c of candidates) {
    if (isQuickScope(c)) {
      keys.add(c);
    }
  }
  for (const m of macros) {
    if (isQuickScope(m.profileId)) {
      keys.add(m.profileId);
    }
  }
  return [...keys].sort((a, b) => quickScopeLabel(a).localeCompare(quickScopeLabel(b)));
}
