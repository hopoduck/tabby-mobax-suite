import { describe, it, expect } from 'vitest';
import {
  substituteVariables,
  buildVarMap,
  validVarName,
  resolveMacroSteps,
  Variable,
} from './variables';
import { MacroStep } from './macro';

describe('substituteVariables', () => {
  it('substitutes a defined token', () => {
    expect(substituteVariables('echo ${a}', { a: 'hi' })).toBe('echo hi');
  });

  it('substitutes multiple occurrences and multiple variables', () => {
    expect(substituteVariables('${a}-${b}-${a}', { a: '1', b: '2' })).toBe('1-2-1');
  });

  it('leaves undefined tokens literal', () => {
    expect(substituteVariables('x ${foo} y', {})).toBe('x ${foo} y');
  });

  it('does not re-substitute tokens inside a value (single pass)', () => {
    expect(substituteVariables('${a}', { a: '${b}', b: 'NO' })).toBe('${b}');
  });

  it('ignores $name without braces', () => {
    expect(substituteVariables('$a ${a}', { a: 'X' })).toBe('$a X');
  });

  it('substitutes an empty-string value', () => {
    expect(substituteVariables('[${a}]', { a: '' })).toBe('[]');
  });
});

describe('buildVarMap', () => {
  it('includes only valid names', () => {
    const list: Variable[] = [
      { id: '1', name: 'ok', value: 'v1' },
      { id: '2', name: 'bad name', value: 'v2' },
      { id: '3', name: '', value: 'v3' },
    ];
    expect(buildVarMap(list)).toEqual({ ok: 'v1' });
  });

  it('last definition wins on duplicate names', () => {
    const list: Variable[] = [
      { id: '1', name: 'a', value: 'first' },
      { id: '2', name: 'a', value: 'second' },
    ];
    expect(buildVarMap(list)).toEqual({ a: 'second' });
  });
});

describe('validVarName', () => {
  it('accepts letters, digits, underscore, dot, hyphen', () => {
    expect(validVarName('A_b.9-x')).toBe(true);
  });

  it('rejects empty, spaces, and other chars', () => {
    expect(validVarName('')).toBe(false);
    expect(validVarName('a b')).toBe(false);
    expect(validVarName('a$b')).toBe(false);
  });
});

describe('resolveMacroSteps', () => {
  it('substitutes command text only and leaves key steps + original untouched', () => {
    const steps: MacroStep[] = [
      { id: '1', type: 'command', text: 'echo ${a}', enter: true, delayMs: 0 },
      { id: '2', type: 'key', key: 'enter', delayMs: 0 },
    ];
    const out = resolveMacroSteps(steps, { a: 'hi' });
    expect((out[0] as { text: string }).text).toBe('echo hi');
    expect(out[1]).toEqual(steps[1]);
    // original array element is not mutated
    expect((steps[0] as { text: string }).text).toBe('echo ${a}');
  });
});
