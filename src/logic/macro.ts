// Pure, dependency-free macro logic (no Angular/Tabby imports) so it is unit-testable
// without Electron. Mirrors the test policy in CLAUDE.md.

export type MacroKey =
  | 'ctrl-c'
  | 'ctrl-d'
  | 'ctrl-z'
  | 'ctrl-l'
  | 'tab'
  | 'esc'
  | 'enter'
  | 'up'
  | 'down'
  | 'left'
  | 'right';

export interface CommandStep {
  id: string;
  type: 'command';
  text: string;
  enter: boolean;
  delayMs: number;
}

export interface KeyStep {
  id: string;
  type: 'key';
  key: MacroKey;
  delayMs: number;
}

export type MacroStep = CommandStep | KeyStep;

export interface Macro {
  id: string;
  name: string;
  steps: MacroStep[];
  // Scope: absent/null = global (available in every session); otherwise bound to the saved
  // profile with this id (available only when that profile's session is focused).
  profileId?: string | null;
}

// Raw bytes written to the PTY. Enter in a terminal is CR (\r), not LF.
export const KEY_SEQUENCES: Record<MacroKey, string> = {
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
};

export function stepToBytes(step: MacroStep): string {
  if (step.type === 'command') {
    return step.text + (step.enter ? '\r' : '');
  }
  return KEY_SEQUENCES[step.key] ?? '';
}

export interface MacroRunHooks {
  send: (data: string) => void;
  sleep: (ms: number) => Promise<void>;
}

// Sequential typing with inter-step delays. send/sleep are injected so this stays
// pure and unit-testable (no setTimeout, no Tabby session).
export async function runMacro(steps: MacroStep[], hooks: MacroRunHooks): Promise<void> {
  for (const step of steps) {
    hooks.send(stepToBytes(step));
    if (step.delayMs > 0) {
      await hooks.sleep(step.delayMs);
    }
  }
}

export function filterMacros(query: string, list: Macro[]): Macro[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return list;
  }
  return list.filter((m) => m.name.toLowerCase().includes(q));
}

// Macros visible/runnable for the active session: globals (no profileId) always, scoped ones
// only when the active scope key (saved-profile id or quick:<device> — see activeScopeKey)
// matches. Order preserved so reordering in the tab is respected.
export function macrosForProfile(list: Macro[], activeScopeKey: string | null): Macro[] {
  return list.filter((m) => !m.profileId || m.profileId === activeScopeKey);
}

// The macros tab renders a filtered subset (view) of the full list. CDK drop gives indices within
// that view, but the full list is what gets persisted — so map the drop back onto the full list,
// relocating the dragged item next to the visible neighbor it was dropped onto and leaving items
// not in the view exactly where they were. Returns a new array (never mutates full).
export function applyVisibleReorder<T>(
  full: T[],
  view: T[],
  fromVisible: number,
  toVisible: number,
): T[] {
  const result = full.slice();
  if (fromVisible === toVisible) {
    return result;
  }
  const moved = view[fromVisible];
  const target = view[toVisible];
  const fromFull = result.indexOf(moved);
  if (fromFull < 0 || moved === target) {
    return result;
  }
  result.splice(fromFull, 1);
  const targetIdx = result.indexOf(target);
  if (targetIdx < 0) {
    return full.slice();
  }
  // Moving down → insert after the target; moving up → insert before it.
  result.splice(toVisible > fromVisible ? targetIdx + 1 : targetIdx, 0, moved);
  return result;
}

// Duck-typed terminal leaf: any BaseTerminalTabComponent (SSH or local) exposes
// sendInput(); session.open guards against typing into a not-yet-connected shell.
export interface TerminalLeafLike {
  sendInput?: (data: string) => void;
  session?: { open?: boolean } | null;
}

export function isTerminalLeaf(leaf: TerminalLeafLike | null | undefined): boolean {
  return typeof leaf?.sendInput === 'function' && leaf?.session?.open === true;
}
