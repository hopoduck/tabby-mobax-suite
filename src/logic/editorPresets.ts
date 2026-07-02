/**
 * Editor presets for the settings-tab dropdown (SFTP 기본 에디터). Pure decision logic:
 * install-path candidates are built from an injected env map and resolved with an injected
 * exists-predicate, so the fs/process access stays in the component.
 */
export type PresetId = 'notepad' | 'notepadpp' | 'vscode';

export const PRESET_IDS: PresetId[] = ['notepad', 'notepadpp', 'vscode'];

/** Candidate install paths per preset, in priority order (built-in notepad needs none). */
export function presetCandidates(
  env: Record<string, string | undefined>,
): Record<PresetId, string[]> {
  const local = env.LOCALAPPDATA;
  const pf = env.ProgramFiles;
  const pf86 = env['ProgramFiles(x86)'];
  const present = (paths: (string | null)[]): string[] =>
    paths.filter((p): p is string => p !== null);
  return {
    notepad: [],
    notepadpp: present([
      pf ? `${pf}\\Notepad++\\notepad++.exe` : null,
      pf86 ? `${pf86}\\Notepad++\\notepad++.exe` : null,
    ]),
    vscode: present([
      local ? `${local}\\Programs\\Microsoft VS Code\\Code.exe` : null,
      pf ? `${pf}\\Microsoft VS Code\\Code.exe` : null,
    ]),
  };
}

/**
 * Resolve each preset to a concrete editorPath value: '' for the built-in notepad default,
 * the first existing candidate otherwise, or null when the editor is not installed.
 */
export function resolvePresets(
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): Record<PresetId, string | null> {
  const candidates = presetCandidates(env);
  const firstExisting = (paths: string[]): string | null => {
    for (const p of paths) {
      if (exists(p)) {
        return p;
      }
    }
    return null;
  };
  return {
    notepad: '',
    notepadpp: firstExisting(candidates.notepadpp),
    vscode: firstExisting(candidates.vscode),
  };
}

/** Which preset the current editorPath corresponds to ('custom' when none match). */
export function matchPreset(
  editorPath: string,
  resolved: Record<PresetId, string | null>,
): PresetId | 'custom' {
  const trimmed = editorPath.trim();
  if (!trimmed) {
    return 'notepad';
  }
  for (const id of PRESET_IDS) {
    const path = resolved[id];
    if (path !== null && path !== '' && path === trimmed) {
      return id;
    }
  }
  return 'custom';
}
