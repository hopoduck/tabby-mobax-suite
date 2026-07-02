import { describe, it, expect } from 'vitest';
import { presetCandidates, resolvePresets, matchPreset } from './editorPresets';

const ENV = {
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
};

describe('presetCandidates', () => {
  it('builds candidate paths from the env map in priority order', () => {
    const c = presetCandidates(ENV);
    expect(c.notepad).toEqual([]);
    expect(c.notepadpp).toEqual([
      'C:\\Program Files\\Notepad++\\notepad++.exe',
      'C:\\Program Files (x86)\\Notepad++\\notepad++.exe',
    ]);
    expect(c.vscode).toEqual([
      'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
    ]);
  });

  it('skips candidates whose env var is missing', () => {
    const c = presetCandidates({ ProgramFiles: 'C:\\Program Files' });
    expect(c.notepadpp).toEqual(['C:\\Program Files\\Notepad++\\notepad++.exe']);
    expect(c.vscode).toEqual(['C:\\Program Files\\Microsoft VS Code\\Code.exe']);
  });
});

describe('resolvePresets', () => {
  it('resolves notepad to the empty string even when nothing is installed', () => {
    const r = resolvePresets(ENV, () => false);
    expect(r.notepad).toBe('');
  });

  it('picks the first existing candidate', () => {
    const x86 = 'C:\\Program Files (x86)\\Notepad++\\notepad++.exe';
    const r = resolvePresets(ENV, (p) => p === x86);
    expect(r.notepadpp).toBe(x86);
  });

  it('returns null when no candidate exists', () => {
    const r = resolvePresets(ENV, () => false);
    expect(r.notepadpp).toBeNull();
    expect(r.vscode).toBeNull();
  });
});

describe('matchPreset', () => {
  const resolved = {
    notepad: '' as string | null,
    notepadpp: 'C:\\Program Files\\Notepad++\\notepad++.exe' as string | null,
    vscode: null as string | null,
  };

  it('maps empty / whitespace-only paths to the notepad preset', () => {
    expect(matchPreset('', resolved)).toBe('notepad');
    expect(matchPreset('   ', resolved)).toBe('notepad');
  });

  it('maps a resolved preset path back to its id', () => {
    expect(matchPreset('C:\\Program Files\\Notepad++\\notepad++.exe', resolved)).toBe('notepadpp');
  });

  it('maps anything else to custom, never matching null-resolved presets', () => {
    expect(matchPreset('D:\\tools\\editor.exe', resolved)).toBe('custom');
    expect(matchPreset('null', resolved)).toBe('custom');
  });
});
