import { describe, it, expect } from 'vitest';
import { rangeNames, rowsInMarquee, stepName, RowRect } from './selection';

describe('rangeNames', () => {
  const names = ['a', 'b', 'c', 'd'];

  it('returns the inclusive forward range', () => {
    expect(rangeNames(names, 'b', 'd')).toEqual(['b', 'c', 'd']);
  });

  it('is order-independent (anchor after target)', () => {
    expect(rangeNames(names, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('returns just the target when anchor is null', () => {
    expect(rangeNames(names, null, 'c')).toEqual(['c']);
  });

  it('returns just the target when anchor is missing from the list', () => {
    expect(rangeNames(names, 'zzz', 'c')).toEqual(['c']);
  });

  it('returns a single name when anchor equals target', () => {
    expect(rangeNames(names, 'c', 'c')).toEqual(['c']);
  });
});

describe('rowsInMarquee', () => {
  const rows: RowRect[] = [
    { name: 'a', top: 0, bottom: 10 },
    { name: 'b', top: 10, bottom: 20 },
    { name: 'c', top: 20, bottom: 30 },
  ];

  it('selects rows whose vertical span overlaps the marquee', () => {
    expect(rowsInMarquee(rows, { top: 5, bottom: 25 })).toEqual(['a', 'b', 'c']);
  });

  it('excludes rows fully above or below', () => {
    expect(rowsInMarquee(rows, { top: 21, bottom: 29 })).toEqual(['c']);
  });

  it('returns empty when the marquee touches nothing', () => {
    expect(rowsInMarquee(rows, { top: 30, bottom: 40 })).toEqual([]);
  });
});

describe('stepName', () => {
  const names = ['a', 'b', 'c', 'd'];

  it('returns null for an empty list', () => {
    expect(stepName([], null, 1)).toBeNull();
  });

  it('lands on the first row stepping forward from nothing', () => {
    expect(stepName(names, null, 1)).toBe('a');
  });

  it('lands on the last row stepping backward from nothing', () => {
    expect(stepName(names, null, -1)).toBe('d');
  });

  it('steps to the next and previous row', () => {
    expect(stepName(names, 'b', 1)).toBe('c');
    expect(stepName(names, 'b', -1)).toBe('a');
  });

  it('clamps at the ends', () => {
    expect(stepName(names, 'd', 1)).toBe('d');
    expect(stepName(names, 'a', -1)).toBe('a');
  });

  it('clamps a page-sized step', () => {
    expect(stepName(names, 'a', 10)).toBe('d');
    expect(stepName(names, 'd', -10)).toBe('a');
  });

  it('falls back to the first row when current is absent', () => {
    expect(stepName(names, 'zzz', 1)).toBe('a');
  });
});
