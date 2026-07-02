import { describe, it, expect } from 'vitest';
import { countLiveByProfile, dotCount, MAX_DOTS } from './sessionStatus';

// Helpers mirroring Tabby's runtime shapes (duck-typed).
const leaf = (id: string | undefined, open: boolean) => ({
  profile: id === undefined ? undefined : { id },
  session: { open },
});
const split = (...children: unknown[]) => ({ getAllTabs: () => children });

describe('countLiveByProfile', () => {
  it('counts one live pane per profile', () => {
    const tabs = [split(leaf('a', true)), split(leaf('b', true))];
    expect(countLiveByProfile(tabs)).toEqual(
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
    );
  });

  it('sums multiple live panes of the same profile (across tabs and within a split)', () => {
    const tabs = [split(leaf('a', true)), split(leaf('a', true), leaf('a', true))];
    expect(countLiveByProfile(tabs).get('a')).toBe(3);
  });

  it('excludes disconnected panes (session not open)', () => {
    const tabs = [split(leaf('a', true), leaf('a', false)), split(leaf('b', false))];
    const counts = countLiveByProfile(tabs);
    expect(counts.get('a')).toBe(1);
    expect(counts.has('b')).toBe(false);
  });

  it('ignores leaves with no profile id or no session', () => {
    const tabs = [
      split(leaf(undefined, true)),
      split({ profile: { id: 'x' } }), // no session
      split({ profile: { id: '' }, session: { open: true } }), // empty id
    ];
    expect(countLiveByProfile(tabs).size).toBe(0);
  });

  it('treats a raw (non-split) top tab as its own single leaf', () => {
    const tabs = [leaf('a', true)];
    expect(countLiveByProfile(tabs).get('a')).toBe(1);
  });

  it('is robust to null tabs, empty input, and a non-array getAllTabs', () => {
    expect(countLiveByProfile([]).size).toBe(0);
    expect(countLiveByProfile([null, undefined]).size).toBe(0);
    expect(countLiveByProfile([{ getAllTabs: () => null as unknown as unknown[] }]).size).toBe(0);
    expect(countLiveByProfile(null as unknown as unknown[]).size).toBe(0);
  });
});

describe('dotCount', () => {
  it('maps live counts to 0..MAX_DOTS', () => {
    expect(dotCount(0)).toBe(0);
    expect(dotCount(1)).toBe(1);
    expect(dotCount(2)).toBe(2);
    expect(dotCount(3)).toBe(3);
  });

  it('clamps counts above the max', () => {
    expect(dotCount(4)).toBe(MAX_DOTS);
    expect(dotCount(99)).toBe(MAX_DOTS);
  });

  it('honours a custom max', () => {
    expect(dotCount(5, 2)).toBe(2);
  });

  it('guards against negative / non-finite input', () => {
    expect(dotCount(-1)).toBe(0);
    expect(dotCount(NaN)).toBe(0);
    // Infinity is non-finite → treated as "no reliable count" → 0 (not clamped to the max).
    expect(dotCount(Infinity)).toBe(0);
  });
});
