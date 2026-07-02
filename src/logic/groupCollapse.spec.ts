import { describe, it, expect } from 'vitest';
import { isExpanded, toggleExpanded } from './groupCollapse';

describe('isExpanded', () => {
  it('is true only when the key is present', () => {
    expect(isExpanded(['a', 'b'], 'a')).toBe(true);
    expect(isExpanded(['a', 'b'], 'c')).toBe(false);
    expect(isExpanded([], 'a')).toBe(false);
  });
});

describe('toggleExpanded', () => {
  it('adds the key when absent', () => {
    expect(toggleExpanded(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes the key when present', () => {
    expect(toggleExpanded(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('round-trips back to the original set', () => {
    const once = toggleExpanded([], 'x');
    expect(once).toEqual(['x']);
    expect(toggleExpanded(once, 'x')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = ['a'];
    toggleExpanded(input, 'b');
    expect(input).toEqual(['a']);
  });
});
