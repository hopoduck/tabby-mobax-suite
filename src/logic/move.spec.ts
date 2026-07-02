import { describe, it, expect } from 'vitest';
import { planMoves, DraggedItem } from './move';

const file = (name: string, dir: string): DraggedItem => ({
  name,
  fullPath: (dir === '/' ? '' : dir) + '/' + name,
  isDirectory: false,
});
const dir = (name: string, parent: string): DraggedItem => ({
  ...file(name, parent),
  isDirectory: true,
});

describe('planMoves', () => {
  it('moves a file into the target dir', () => {
    const plan = planMoves([file('a.txt', '/home')], '/home/sub', new Set());
    expect(plan.moves).toEqual([{ from: '/home/a.txt', to: '/home/sub/a.txt' }]);
    expect(plan.skipped).toEqual([]);
  });

  it('joins correctly when the target is root', () => {
    const plan = planMoves([file('a.txt', '/home')], '/', new Set());
    expect(plan.moves).toEqual([{ from: '/home/a.txt', to: '/a.txt' }]);
  });

  it('skips an item already in the target dir', () => {
    const plan = planMoves([file('a.txt', '/home')], '/home', new Set());
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'a.txt', reason: 'sameDir' }]);
  });

  it('skips moving a folder into itself', () => {
    const plan = planMoves([dir('proj', '/home')], '/home/proj', new Set());
    expect(plan.skipped).toEqual([{ name: 'proj', reason: 'self' }]);
  });

  it('skips moving a folder into its own descendant', () => {
    const plan = planMoves([dir('proj', '/home')], '/home/proj/sub', new Set());
    expect(plan.skipped).toEqual([{ name: 'proj', reason: 'self' }]);
  });

  it('skips a name collision in the target', () => {
    const plan = planMoves([file('a.txt', '/home')], '/dst', new Set(['a.txt']));
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'a.txt', reason: 'collision' }]);
  });

  it('ignores the ".." entry', () => {
    const dotdot: DraggedItem = { name: '..', fullPath: '/home', isDirectory: true };
    const plan = planMoves([dotdot, file('a.txt', '/home')], '/dst', new Set());
    expect(plan.moves).toEqual([{ from: '/home/a.txt', to: '/dst/a.txt' }]);
    expect(plan.skipped).toEqual([]);
  });

  it('does not treat a sibling prefix as a descendant', () => {
    // '/home/proj' must NOT be considered an ancestor of '/home/proj-2'.
    const plan = planMoves([dir('proj', '/home')], '/home/proj-2', new Set());
    expect(plan.moves).toEqual([{ from: '/home/proj', to: '/home/proj-2/proj' }]);
  });
});
