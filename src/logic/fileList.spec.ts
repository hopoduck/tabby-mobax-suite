import { describe, it, expect } from 'vitest';
import {
  sortEntries,
  applyFilter,
  iconFor,
  iconColor,
  modeString,
  classifyClick,
  FileEntry,
} from './fileList';

const f = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  name,
  isDirectory: false,
  isSymlink: false,
  mode: 0o644,
  ...over,
});

describe('sortEntries', () => {
  it('puts directories before files', () => {
    const out = sortEntries([f('a.txt'), f('zdir', { isDirectory: true })]);
    expect(out.map((e) => e.name)).toEqual(['zdir', 'a.txt']);
  });

  it('sorts case-insensitively within each group', () => {
    const out = sortEntries([f('Banana'), f('apple'), f('Cherry')]);
    expect(out.map((e) => e.name)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('does not mutate the input array', () => {
    const input = [f('b'), f('a')];
    sortEntries(input);
    expect(input.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('applyFilter', () => {
  it('returns all entries for an empty query', () => {
    const list = [f('a'), f('b')];
    expect(applyFilter(list, '')).toHaveLength(2);
  });

  it('matches case-insensitive substrings', () => {
    const out = applyFilter([f('README.md'), f('main.ts')], 'me');
    expect(out.map((e) => e.name)).toEqual(['README.md']);
  });
});

describe('iconFor', () => {
  it('returns a folder icon for directories', () => {
    expect(iconFor(f('d', { isDirectory: true }))).toContain('fa-folder');
  });

  it('returns a link icon for symlinks', () => {
    expect(iconFor(f('l', { isSymlink: true }))).toContain('fa-link');
  });

  it('returns an archive icon for .zip', () => {
    expect(iconFor(f('x.zip'))).toContain('fa-file-archive');
  });

  it('falls back to a generic file icon', () => {
    expect(iconFor(f('x.unknownext'))).toContain('fa-file');
  });
});

describe('iconColor', () => {
  it('colors directories as folder', () => {
    expect(iconColor(f('d', { isDirectory: true }))).toBe('mobax-ic-folder');
  });

  it('colors symlinks as link', () => {
    expect(iconColor(f('l', { isSymlink: true }))).toBe('mobax-ic-link');
  });

  it('maps an extension to its category color (matching iconFor)', () => {
    expect(iconColor(f('x.zip'))).toBe('mobax-ic-archive');
    expect(iconColor(f('a.ts'))).toBe('mobax-ic-code');
    expect(iconColor(f('r.md'))).toBe('mobax-ic-text');
    expect(iconColor(f('p.pdf'))).toBe('mobax-ic-pdf');
    expect(iconColor(f('i.png'))).toBe('mobax-ic-image');
  });

  it('returns an empty class for a generic file', () => {
    expect(iconColor(f('x.unknownext'))).toBe('');
    expect(iconColor(f('noext'))).toBe('');
  });
});

describe('modeString', () => {
  it('renders a regular file 644', () => {
    expect(modeString(f('x', { mode: 0o644 }))).toBe('-rw-r--r--');
  });

  it('renders a directory 755', () => {
    expect(modeString(f('d', { isDirectory: true, mode: 0o755 }))).toBe('drwxr-xr-x');
  });

  it('renders a symlink', () => {
    expect(modeString(f('l', { isSymlink: true, mode: 0o777 }))).toBe('lrwxrwxrwx');
  });
});

describe('classifyClick', () => {
  it('is single on the first click', () => {
    const r = classifyClick(null, 'a', 1000);
    expect(r.type).toBe('single');
    expect(r.state).toEqual({ name: 'a', at: 1000 });
  });

  it('is double on a fast re-click of the same item', () => {
    const first = classifyClick(null, 'a', 1000);
    const r = classifyClick(first.state, 'a', 1200, 400);
    expect(r.type).toBe('double');
  });

  it('is single when the re-click is too slow', () => {
    const first = classifyClick(null, 'a', 1000);
    const r = classifyClick(first.state, 'a', 1500, 400);
    expect(r.type).toBe('single');
  });

  it('is single when a different item is clicked within the window', () => {
    const first = classifyClick(null, 'a', 1000);
    const r = classifyClick(first.state, 'b', 1100, 400);
    expect(r.type).toBe('single');
  });
});
