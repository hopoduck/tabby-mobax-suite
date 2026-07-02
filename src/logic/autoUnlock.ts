// Pure, dependency-free decision logic (unit-tested; no Angular/Tabby/Electron imports).
export type UnlockState = { hasStored: boolean; lastFailed: boolean };
export type UnlockDecision = 'supply' | 'prompt';

/** Supply the stored passphrase only when one exists and it has not just failed. */
export function decideUnlock(s: UnlockState): UnlockDecision {
  return s.hasStored && !s.lastFailed ? 'supply' : 'prompt';
}
