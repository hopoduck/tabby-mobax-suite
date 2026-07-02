import { describe, it, expect } from 'vitest';
import {
  stepToBytes,
  KEY_SEQUENCES,
  MacroStep,
  runMacro,
  filterMacros,
  macrosForProfile,
  applyVisibleReorder,
  isTerminalLeaf,
  Macro,
} from './macro';

describe('stepToBytes', () => {
  it('command + enter true → text + CR', () => {
    const step: MacroStep = { id: 'a', type: 'command', text: 'ls -al', enter: true, delayMs: 0 };
    expect(stepToBytes(step)).toBe('ls -al\r');
  });

  it('command + enter false → text only', () => {
    const step: MacroStep = { id: 'a', type: 'command', text: 'sudo ', enter: false, delayMs: 0 };
    expect(stepToBytes(step)).toBe('sudo ');
  });

  it('key step → mapped control sequence', () => {
    const step: MacroStep = { id: 'b', type: 'key', key: 'ctrl-c', delayMs: 0 };
    expect(stepToBytes(step)).toBe('\x03');
  });

  it('KEY_SEQUENCES covers every key with the expected bytes', () => {
    expect(KEY_SEQUENCES).toEqual({
      enter: '\r',
      'ctrl-c': '\x03',
      'ctrl-d': '\x04',
      'ctrl-z': '\x1a',
      'ctrl-l': '\x0c',
      tab: '\t',
      esc: '\x1b',
      up: '\x1b[A',
      down: '\x1b[B',
      right: '\x1b[C',
      left: '\x1b[D',
    });
  });
});

describe('runMacro', () => {
  it('sends each step in order and sleeps only when delayMs > 0', async () => {
    const sent: string[] = [];
    const slept: number[] = [];
    const steps: MacroStep[] = [
      { id: '1', type: 'command', text: 'a', enter: true, delayMs: 100 },
      { id: '2', type: 'command', text: 'b', enter: false, delayMs: 0 },
      { id: '3', type: 'key', key: 'ctrl-c', delayMs: 50 },
    ];
    await runMacro(steps, {
      send: (d) => sent.push(d),
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect(sent).toEqual(['a\r', 'b', '\x03']);
    expect(slept).toEqual([100, 50]);
  });
});

describe('filterMacros', () => {
  const list: Macro[] = [
    { id: '1', name: 'docker 정리', steps: [] },
    { id: '2', name: 'Docker compose', steps: [] },
    { id: '3', name: 'k8s pods', steps: [] },
  ];

  it('empty query returns all in original order', () => {
    expect(filterMacros('', list).map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('case-insensitive substring match, order preserved', () => {
    expect(filterMacros('docker', list).map((m) => m.id)).toEqual(['1', '2']);
  });

  it('no match returns empty', () => {
    expect(filterMacros('zzz', list)).toEqual([]);
  });
});

describe('macrosForProfile', () => {
  const list: Macro[] = [
    { id: 'g1', name: 'global no field', steps: [] },
    { id: 'g2', name: 'global null', steps: [], profileId: null },
    { id: 'a1', name: 'prod-web only', steps: [], profileId: 'web' },
    { id: 'b1', name: 'prod-db only', steps: [], profileId: 'db' },
  ];

  it('includes globals (absent or null profileId) plus the matching profile', () => {
    expect(macrosForProfile(list, 'web').map((m) => m.id)).toEqual(['g1', 'g2', 'a1']);
  });

  it('with null active profile returns globals only', () => {
    expect(macrosForProfile(list, null).map((m) => m.id)).toEqual(['g1', 'g2']);
  });

  it('preserves original order', () => {
    expect(macrosForProfile(list, 'db').map((m) => m.id)).toEqual(['g1', 'g2', 'b1']);
  });

  it('empty list → empty result', () => {
    expect(macrosForProfile([], 'web')).toEqual([]);
  });
});

describe('applyVisibleReorder', () => {
  it('reorders like a normal move when the view is the whole list', () => {
    const full = ['a', 'b', 'c', 'd'];
    expect(applyVisibleReorder(full, full, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(applyVisibleReorder(full, full, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves the dragged item next to its visible neighbor, keeping hidden items in place', () => {
    // full has hidden items 'h1','h2' interleaved; view is only the visible ones.
    const full = ['v1', 'h1', 'v2', 'h2', 'v3'];
    const view = ['v1', 'v2', 'v3'];
    // drag v1 (visible 0) down onto v3 (visible 2): v1 lands right after v3; h1/h2 unmoved.
    expect(applyVisibleReorder(full, view, 0, 2)).toEqual(['h1', 'v2', 'h2', 'v3', 'v1']);
    // drag v3 (visible 2) up onto v1 (visible 0): v3 lands right before v1.
    expect(applyVisibleReorder(full, view, 2, 0)).toEqual(['v3', 'v1', 'h1', 'v2', 'h2']);
  });

  it('returns an unchanged copy when from === to', () => {
    const full = ['a', 'b'];
    const out = applyVisibleReorder(full, full, 1, 1);
    expect(out).toEqual(['a', 'b']);
    expect(out).not.toBe(full);
  });

  it('returns an unchanged copy when the moved item is not in full (defensive)', () => {
    const full = ['a', 'b'];
    expect(applyVisibleReorder(full, ['x', 'b'], 0, 1)).toEqual(['a', 'b']);
  });
});

describe('isTerminalLeaf', () => {
  it('true when sendInput is a function and session.open === true', () => {
    expect(isTerminalLeaf({ sendInput: () => undefined, session: { open: true } })).toBe(true);
  });

  it('false when session not open', () => {
    expect(isTerminalLeaf({ sendInput: () => undefined, session: { open: false } })).toBe(false);
  });

  it('false when sendInput missing', () => {
    expect(isTerminalLeaf({ session: { open: true } })).toBe(false);
  });

  it('false for null', () => {
    expect(isTerminalLeaf(null)).toBe(false);
  });
});
