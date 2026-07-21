import { describe, it, expect } from 'vitest';
import { QUICK_SCOPE_PREFIX, isQuickScope, quickScopeLabel, quickScopeChoices } from './scopeKey';
import { Macro } from './macro';

const macro = (profileId: string | null): Macro => ({
  id: 'm-' + (profileId ?? 'global'),
  name: 'm',
  steps: [],
  profileId,
});

describe('isQuickScope', () => {
  it('accepts quick: keys and rejects everything else', () => {
    expect(isQuickScope('quick:bom-bd03.kt.com')).toBe(true);
    expect(isQuickScope('ssh:custom:web:uuid')).toBe(false);
    expect(isQuickScope(null)).toBe(false);
    expect(isQuickScope(undefined)).toBe(false);
    expect(isQuickScope('')).toBe(false);
  });
});

describe('quickScopeLabel', () => {
  it('strips the prefix from a quick key', () => {
    expect(quickScopeLabel(QUICK_SCOPE_PREFIX + 'bom-bd03.kt.com')).toBe('bom-bd03.kt.com');
  });
  it('passes a non-quick key through', () => {
    expect(quickScopeLabel('ssh:custom:web:uuid')).toBe('ssh:custom:web:uuid');
  });
});

describe('quickScopeChoices', () => {
  it('collects quick keys from candidates and existing macros, deduped', () => {
    const out = quickScopeChoices(
      ['quick:dev-b', null],
      [macro('quick:dev-a'), macro('quick:dev-b'), macro(null)],
    );
    expect(out).toEqual(['quick:dev-a', 'quick:dev-b']);
  });
  it('ignores saved-profile ids in both sources', () => {
    const out = quickScopeChoices(['ssh:custom:web:uuid'], [macro('ssh:custom:db:uuid')]);
    expect(out).toEqual([]);
  });
  it('sorts by device name', () => {
    const out = quickScopeChoices([], [macro('quick:zeta'), macro('quick:alpha')]);
    expect(out).toEqual(['quick:alpha', 'quick:zeta']);
  });
  it('returns empty when there are no quick keys anywhere', () => {
    expect(quickScopeChoices([null], [macro(null)])).toEqual([]);
  });
});
