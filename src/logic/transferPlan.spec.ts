import { describe, it, expect } from 'vitest';
import {
  memoryAction,
  resolveConflict,
  relativeUnder,
  selectionNeedsDirPicker,
  CONFLICT_BUTTON_CHOICES,
  planRemoteUpload,
} from './transferPlan';

describe('memoryAction', () => {
  it('returns null when there is no standing memory (must prompt)', () => {
    expect(memoryAction('none')).toBeNull();
  });
  it('auto-overwrites under all-overwrite memory', () => {
    expect(memoryAction('all-overwrite')).toBe('overwrite');
  });
  it('auto-skips under all-skip memory', () => {
    expect(memoryAction('all-skip')).toBe('skip');
  });
});

describe('resolveConflict', () => {
  it('one-off overwrite keeps no standing memory', () => {
    expect(resolveConflict('overwrite')).toEqual({ action: 'overwrite', memory: 'none' });
  });
  it('one-off skip keeps no standing memory', () => {
    expect(resolveConflict('skip')).toEqual({ action: 'skip', memory: 'none' });
  });
  it('overwrite-all sets all-overwrite memory', () => {
    expect(resolveConflict('overwrite-all')).toEqual({
      action: 'overwrite',
      memory: 'all-overwrite',
    });
  });
  it('skip-all sets all-skip memory', () => {
    expect(resolveConflict('skip-all')).toEqual({ action: 'skip', memory: 'all-skip' });
  });
  it('cancel aborts with no memory', () => {
    expect(resolveConflict('cancel')).toEqual({ action: 'cancel', memory: 'none' });
  });
});

describe('CONFLICT_BUTTON_CHOICES', () => {
  it('is the five buttons in dialog order', () => {
    expect(CONFLICT_BUTTON_CHOICES).toEqual([
      'overwrite',
      'skip',
      'overwrite-all',
      'skip-all',
      'cancel',
    ]);
  });
});

describe('relativeUnder', () => {
  it('mirrors a nested path under the listing dir', () => {
    expect(relativeUnder('/a/b', '/a/b/myfolder/sub/x.txt')).toBe('myfolder/sub/x.txt');
  });
  it('returns just the name for a top-level entry', () => {
    expect(relativeUnder('/a/b', '/a/b/file.txt')).toBe('file.txt');
  });
  it('works when the base is root', () => {
    expect(relativeUnder('/', '/myfolder/x')).toBe('myfolder/x');
  });
});

describe('selectionNeedsDirPicker', () => {
  it('is true when any selected entry is a directory', () => {
    expect(selectionNeedsDirPicker([{ isDirectory: false }, { isDirectory: true }])).toBe(true);
  });
  it('is false for a files-only selection', () => {
    expect(selectionNeedsDirPicker([{ isDirectory: false }, { isDirectory: false }])).toBe(false);
  });
  it('is false for an empty selection', () => {
    expect(selectionNeedsDirPicker([])).toBe(false);
  });
});

describe('planRemoteUpload', () => {
  it('maps a single dropped file into destDir under its basename', () => {
    const plan = planRemoteUpload(
      [
        {
          baseName: 'a.txt',
          isDirectory: false,
          dirRels: [],
          files: [{ rel: '', localPath: '/local/a.txt', size: 10 }],
        },
      ],
      '/remote/dir',
    );
    expect(plan.dirs).toEqual([]);
    expect(plan.files).toEqual([
      { localPath: '/local/a.txt', remotePath: '/remote/dir/a.txt', name: 'a.txt', size: 10 },
    ]);
  });

  it('mirrors a directory source: dirs (root + nested) and files keep relative layout', () => {
    const plan = planRemoteUpload(
      [
        {
          baseName: 'proj',
          isDirectory: true,
          dirRels: ['', 'sub'],
          files: [
            { rel: 'top.txt', localPath: '/local/proj/top.txt', size: 1 },
            { rel: 'sub/b.txt', localPath: '/local/proj/sub/b.txt', size: 2 },
          ],
        },
      ],
      '/remote',
    );
    expect(plan.dirs).toEqual(['/remote/proj', '/remote/proj/sub']);
    expect(plan.files).toEqual([
      {
        localPath: '/local/proj/top.txt',
        remotePath: '/remote/proj/top.txt',
        name: 'top.txt',
        size: 1,
      },
      {
        localPath: '/local/proj/sub/b.txt',
        remotePath: '/remote/proj/sub/b.txt',
        name: 'b.txt',
        size: 2,
      },
    ]);
  });

  it('concatenates multiple sources (mixed file + dir)', () => {
    const plan = planRemoteUpload(
      [
        {
          baseName: 'a.txt',
          isDirectory: false,
          dirRels: [],
          files: [{ rel: '', localPath: '/l/a.txt', size: 1 }],
        },
        {
          baseName: 'd',
          isDirectory: true,
          dirRels: [''],
          files: [{ rel: 'x', localPath: '/l/d/x', size: 2 }],
        },
      ],
      '/r',
    );
    expect(plan.dirs).toEqual(['/r/d']);
    expect(plan.files.map((f) => f.remotePath)).toEqual(['/r/a.txt', '/r/d/x']);
  });

  it('treats an empty destDir as root (matches joinPath dir||"/" semantics)', () => {
    const plan = planRemoteUpload(
      [
        {
          baseName: 'a.txt',
          isDirectory: false,
          dirRels: [],
          files: [{ rel: '', localPath: '/l/a.txt', size: 1 }],
        },
      ],
      '',
    );
    expect(plan.files[0].remotePath).toBe('/a.txt');
  });
});
