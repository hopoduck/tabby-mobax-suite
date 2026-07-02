// Pure, dependency-free variable substitution (no Angular/Tabby imports) so it is
// unit-testable without Electron. Mirrors the test policy in CLAUDE.md.
import { MacroStep } from './macro';

export interface Variable {
  id: string;
  name: string; // referenced as ${name}
  value: string; // plain-text replacement
}

// Token = ${name}; name allows letters, digits, underscore, dot, hyphen.
const TOKEN_RE = /\$\{([A-Za-z0-9_.-]+)\}/g;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

export function validVarName(name: string): boolean {
  return NAME_RE.test(name);
}

// Single-pass replace: the replacer FUNCTION form means a value's own ${...} is never
// re-scanned, and replacement special patterns ($&, $1...) are NOT interpreted.
// Undefined names are left as the original ${name} literal.
export function substituteVariables(text: string, varMap: Record<string, string>): string {
  return text.replace(TOKEN_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(varMap, name) ? varMap[name] : whole,
  );
}

// Build the lookup from the stored list. Invalid/empty names are dropped; on duplicate
// names the later definition wins.
export function buildVarMap(list: Variable[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const v of list) {
    if (validVarName(v.name)) {
      map[v.name] = v.value;
    }
  }
  return map;
}

// Substitute only command-step text; key steps and all other fields pass through.
// Returns a new array; never mutates the input steps.
export function resolveMacroSteps(steps: MacroStep[], varMap: Record<string, string>): MacroStep[] {
  return steps.map((s) =>
    s.type === 'command' ? { ...s, text: substituteVariables(s.text, varMap) } : s,
  );
}
