import { describe, it, expect } from 'vitest';
import {
  buildExport,
  serializeExport,
  parseImport,
  applyImport,
  countConflicts,
  resolveProfileScopes,
  isParseOk,
} from './macroIO';
import { Macro } from './macro';
import { Variable } from './variables';

const macro = (name: string, extra: Partial<Macro> = {}): Macro => ({
  id: 'm-' + name,
  name,
  steps: [],
  profileId: null,
  ...extra,
});
const variable = (name: string, value = ''): Variable => ({ id: 'v-' + name, name, value });
const seqId = (): (() => string) => {
  let n = 0;
  return () => 'gen' + n++;
};

describe('buildExport', () => {
  it('stamps version 1 and keeps the macro profileId', () => {
    const file = buildExport([macro('deploy', { profileId: 'p1' })], [variable('host', '1.2.3.4')]);
    expect(file.version).toBe(1);
    expect(file.macros[0].profileId).toBe('p1');
    expect(file.macros[0].name).toBe('deploy');
    expect(file.variables[0]).toEqual({ id: 'v-host', name: 'host', value: '1.2.3.4' });
  });

  it('normalizes a missing profileId to null', () => {
    const file = buildExport([{ id: 'x', name: 'g', steps: [] }], []);
    expect(file.macros[0].profileId).toBeNull();
  });
});

describe('serializeExport / parseImport round-trip', () => {
  it('serialized export parses back to the same macros/variables', () => {
    const file = buildExport([macro('a', { profileId: 'p1' })], [variable('x', '1')]);
    const parsed = parseImport(serializeExport(file));
    expect(parsed.ok).toBe(true);
    if (!isParseOk(parsed)) return;
    expect(parsed.macros.map((m) => m.name)).toEqual(['a']);
    expect(parsed.macros[0].profileId).toBe('p1');
    expect(parsed.variables).toEqual([{ id: 'v-x', name: 'x', value: '1' }]);
    expect(parsed.skipped).toBe(0);
  });
});

describe('parseImport validation', () => {
  it('rejects non-JSON', () => {
    expect(parseImport('not json {').ok).toBe(false);
  });
  it('rejects a non-object top level', () => {
    expect(parseImport('[]').ok).toBe(false);
    expect(parseImport('42').ok).toBe(false);
  });
  it('rejects an unsupported version', () => {
    expect(parseImport(JSON.stringify({ version: 2, macros: [], variables: [] })).ok).toBe(false);
  });
  it('rejects when macros or variables is not an array', () => {
    expect(parseImport(JSON.stringify({ version: 1, macros: {}, variables: [] })).ok).toBe(false);
    expect(parseImport(JSON.stringify({ version: 1, macros: [], variables: 5 })).ok).toBe(false);
  });
  it('skips malformed entries and counts them', () => {
    const text = JSON.stringify({
      version: 1,
      macros: [{ name: 'ok', steps: [] }, { name: 'bad-no-steps' }, { steps: [] }],
      variables: [{ name: 'v', value: '1' }, { value: 'no-name' }],
    });
    const r = parseImport(text);
    expect(r.ok).toBe(true);
    if (!isParseOk(r)) return;
    expect(r.macros.map((m) => m.name)).toEqual(['ok']);
    expect(r.variables.map((v) => v.name)).toEqual(['v']);
    expect(r.skipped).toBe(3);
  });
  it('keeps the imported macro profileId (resolution happens later)', () => {
    const text = JSON.stringify({
      version: 1,
      macros: [{ id: 'x', name: 'm', steps: [], profileId: 'p9' }],
      variables: [],
    });
    const r = parseImport(text);
    expect(r.ok).toBe(true);
    if (!isParseOk(r)) return;
    expect(r.macros[0].profileId).toBe('p9');
  });
});

describe('resolveProfileScopes', () => {
  it('keeps a profileId that exists locally', () => {
    const out = resolveProfileScopes([macro('a', { profileId: 'p1' })], ['p1', 'p2']);
    expect(out[0].profileId).toBe('p1');
  });
  it('falls back to global when the profileId is not local', () => {
    const out = resolveProfileScopes([macro('a', { profileId: 'gone' })], ['p1']);
    expect(out[0].profileId).toBeNull();
  });
  it('leaves an already-global macro as global', () => {
    const out = resolveProfileScopes([macro('a', { profileId: null })], ['p1']);
    expect(out[0].profileId).toBeNull();
  });
});

describe('countConflicts', () => {
  it('counts name collisions across macros and variables', () => {
    const existing = { macros: [macro('a'), macro('b')], variables: [variable('x')] };
    const incoming = { macros: [macro('b'), macro('c')], variables: [variable('x'), variable('y')] };
    expect(countConflicts(existing, incoming)).toBe(2);
  });
});

describe('applyImport — replace', () => {
  it('discards existing and uses incoming with fresh ids', () => {
    const out = applyImport(
      { macros: [macro('old')], variables: [variable('oldv')] },
      { macros: [macro('new')], variables: [variable('newv')] },
      { mode: 'replace', onConflict: 'overwrite' },
      seqId(),
    );
    expect(out.macros.map((m) => m.name)).toEqual(['new']);
    expect(out.variables.map((v) => v.name)).toEqual(['newv']);
    expect(out.macros[0].id).toBe('gen0');
  });
});

describe('applyImport — merge overwrite', () => {
  it('replaces same-name in place, appends new, keeps non-conflicting', () => {
    const out = applyImport(
      { macros: [macro('a', { id: 'old-a' }), macro('b', { id: 'old-b' })], variables: [] },
      { macros: [macro('a', { id: 'in-a' }), macro('c')], variables: [] },
      { mode: 'merge', onConflict: 'overwrite' },
      seqId(),
    );
    expect(out.macros.map((m) => m.name)).toEqual(['a', 'b', 'c']);
    expect(out.macros.find((m) => m.name === 'a')!.id).not.toBe('old-a');
  });
});

describe('applyImport — merge skip', () => {
  it('keeps existing same-name, appends only new names', () => {
    const out = applyImport(
      { macros: [macro('a', { id: 'old-a' })], variables: [variable('x', 'keep')] },
      { macros: [macro('a', { id: 'in-a' }), macro('b')], variables: [variable('x', 'drop'), variable('y')] },
      { mode: 'merge', onConflict: 'skip' },
      seqId(),
    );
    expect(out.macros.map((m) => m.name)).toEqual(['a', 'b']);
    expect(out.macros.find((m) => m.name === 'a')!.id).toBe('old-a');
    expect(out.variables.map((v) => v.name)).toEqual(['x', 'y']);
    expect(out.variables.find((v) => v.name === 'x')!.value).toBe('keep');
  });
});

describe('applyImport — fresh ids', () => {
  it('assigns a new id to every incoming item, macros before variables', () => {
    const out = applyImport(
      { macros: [], variables: [] },
      { macros: [macro('a'), macro('b')], variables: [variable('x')] },
      { mode: 'merge', onConflict: 'overwrite' },
      seqId(),
    );
    expect(out.macros.map((m) => m.id)).toEqual(['gen0', 'gen1']);
    expect(out.variables.map((v) => v.id)).toEqual(['gen2']);
  });
});
