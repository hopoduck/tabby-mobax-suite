// Pure, dependency-free import/export logic for macros + variables (no Angular/Tabby imports)
// so it is unit-testable without Electron. Mirrors the test policy in CLAUDE.md.
import { Macro } from './macro';
import { isQuickScope } from './scopeKey';
import { Variable } from './variables';

export interface ExportFile {
  version: 1;
  macros: Macro[];
  variables: Variable[];
}

export interface ImportSet {
  macros: Macro[];
  variables: Variable[];
}

export type ImportMode = 'replace' | 'merge';
export type ConflictPolicy = 'overwrite' | 'skip';

export interface ImportOptions {
  mode: ImportMode;
  onConflict: ConflictPolicy;
}

export interface ParseOk {
  ok: true;
  macros: Macro[];
  variables: Variable[];
  skipped: number;
}
export interface ParseError {
  ok: false;
  error: string;
}
export type ParseResult = ParseOk | ParseError;

// Explicit type guard. This project's tsconfig has strictNullChecks:false, which disables
// control-flow narrowing on a boolean discriminant (`if (parsed.ok)` won't narrow the union).
// A type predicate narrows regardless of strict mode, so callers use this instead of `parsed.ok`.
export function isParseOk(result: ParseResult): result is ParseOk {
  return result.ok;
}

const nameKey = (s: string): string => s.trim();

// Export the current macros + variables. The macro's profileId is kept verbatim so a re-import on
// a machine that has the same profile id can restore the binding (see resolveProfileScopes); on a
// machine without it, the import falls back to global. (Legacy macros may lack profileId → null.)
export function buildExport(macros: Macro[], variables: Variable[]): ExportFile {
  return {
    version: 1,
    macros: macros.map((m) => ({ ...m, profileId: m.profileId ?? null })),
    variables: variables.map((v) => ({ ...v })),
  };
}

// Remap imported macros' profileId against the profile ids that actually exist locally: keep a
// binding whose id is present, otherwise fall back to global (null). quick:* device keys are
// machine-independent (not tied to any saved profile), so they always pass through verbatim.
// Pure so it stays unit-testable.
export function resolveProfileScopes(macros: Macro[], validProfileIds: Iterable<string>): Macro[] {
  const valid = new Set(validProfileIds);
  return macros.map((m) => ({
    ...m,
    profileId:
      m.profileId && (isQuickScope(m.profileId) || valid.has(m.profileId)) ? m.profileId : null,
  }));
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

function sanitizeMacro(item: unknown): Macro | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const o = item as Record<string, unknown>;
  if (typeof o.name !== 'string' || !Array.isArray(o.steps)) {
    return null;
  }
  return {
    id: typeof o.id === 'string' ? o.id : '',
    name: o.name,
    steps: o.steps as Macro['steps'],
    // Keep the exported profileId; it is resolved against local profiles at import time
    // (resolveProfileScopes), not dropped here.
    profileId: typeof o.profileId === 'string' ? o.profileId : null,
  };
}

function sanitizeVariable(item: unknown): Variable | null {
  if (typeof item !== 'object' || item === null) {
    return null;
  }
  const o = item as Record<string, unknown>;
  if (typeof o.name !== 'string') {
    return null;
  }
  return {
    id: typeof o.id === 'string' ? o.id : '',
    name: o.name,
    value: typeof o.value === 'string' ? o.value : '',
  };
}

export function parseImport(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON 형식이 아닙니다.' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: '잘못된 파일 형식입니다.' };
  }
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) {
    return { ok: false, error: '지원하지 않는 버전입니다: ' + String(obj.version) };
  }
  if (!Array.isArray(obj.macros) || !Array.isArray(obj.variables)) {
    return { ok: false, error: 'macros / variables 항목이 배열이 아닙니다.' };
  }
  let skipped = 0;
  const macros: Macro[] = [];
  for (const item of obj.macros) {
    const m = sanitizeMacro(item);
    if (m) {
      macros.push(m);
    } else {
      skipped++;
    }
  }
  const variables: Variable[] = [];
  for (const item of obj.variables) {
    const v = sanitizeVariable(item);
    if (v) {
      variables.push(v);
    } else {
      skipped++;
    }
  }
  return { ok: true, macros, variables, skipped };
}

export function countConflicts(existing: ImportSet, incoming: ImportSet): number {
  const mNames = new Set(existing.macros.map((m) => nameKey(m.name)));
  const vNames = new Set(existing.variables.map((v) => nameKey(v.name)));
  let n = 0;
  for (const m of incoming.macros) {
    if (mNames.has(nameKey(m.name))) {
      n++;
    }
  }
  for (const v of incoming.variables) {
    if (vNames.has(nameKey(v.name))) {
      n++;
    }
  }
  return n;
}

// Merge/replace a single typed list (macros or variables) keyed by trimmed name. Incoming items
// always get a fresh id (collision-proof). Replace = incoming only. Merge = existing plus incoming,
// where a name collision either overwrites the existing entry in place or is skipped.
function mergeList<T extends { id: string; name: string }>(
  existing: T[],
  incoming: T[],
  opts: ImportOptions,
  makeId: () => string,
): T[] {
  const fresh = incoming.map((it) => ({ ...it, id: makeId() }));
  if (opts.mode === 'replace') {
    return fresh;
  }
  const result: T[] = existing.map((it) => ({ ...it }));
  const indexByName = new Map<string, number>();
  result.forEach((it, i) => indexByName.set(nameKey(it.name), i));
  for (const it of fresh) {
    const key = nameKey(it.name);
    const idx = indexByName.get(key);
    if (idx === undefined) {
      result.push(it);
      indexByName.set(key, result.length - 1);
    } else if (opts.onConflict === 'overwrite') {
      result[idx] = it;
    }
    // skip: leave the existing entry untouched
  }
  return result;
}

export function applyImport(
  existing: ImportSet,
  incoming: ImportSet,
  opts: ImportOptions,
  makeId: () => string,
): ImportSet {
  return {
    macros: mergeList(existing.macros, incoming.macros, opts, makeId),
    variables: mergeList(existing.variables, incoming.variables, opts, makeId),
  };
}
