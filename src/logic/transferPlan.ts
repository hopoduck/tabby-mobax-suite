// Pure decision logic for folder (recursive) SFTP transfers: file-name conflict resolution, the
// local/remote path mirroring rule, and the dest-picker rule. No Angular/Tabby/fs imports so it
// stays unit-testable.
import { posix as posixPath } from 'path';

// What to do with a single conflicting entry.
export type ConflictAction = 'overwrite' | 'skip' | 'cancel';

// Standing decision carried across the rest of the batch once the user picks a "모두…" button.
export type ConflictMemory = 'none' | 'all-overwrite' | 'all-skip';

// The five buttons the conflict dialog offers, in display order.
export type ConflictChoice = 'overwrite' | 'skip' | 'overwrite-all' | 'skip-all' | 'cancel';

// Maps each dialog button index (the showMessageBox `response`) to its choice. The component's
// Korean button labels MUST be declared in this same order.
export const CONFLICT_BUTTON_CHOICES: ConflictChoice[] = [
  'overwrite',
  'skip',
  'overwrite-all',
  'skip-all',
  'cancel',
];

// If standing memory already dictates a conflict's outcome, return the action (no prompt needed);
// otherwise null → the caller must prompt.
export function memoryAction(memory: ConflictMemory): ConflictAction | null {
  if (memory === 'all-overwrite') {
    return 'overwrite';
  }
  if (memory === 'all-skip') {
    return 'skip';
  }
  return null;
}

// Apply the user's button choice for one conflict: the action for THIS entry plus the memory to
// carry into the rest of the batch ('none' for one-off choices, 'all-*' for the "모두…" buttons).
export function resolveConflict(choice: ConflictChoice): {
  action: ConflictAction;
  memory: ConflictMemory;
} {
  switch (choice) {
    case 'overwrite':
      return { action: 'overwrite', memory: 'none' };
    case 'skip':
      return { action: 'skip', memory: 'none' };
    case 'overwrite-all':
      return { action: 'overwrite', memory: 'all-overwrite' };
    case 'skip-all':
      return { action: 'skip', memory: 'all-skip' };
    case 'cancel':
      return { action: 'cancel', memory: 'none' };
  }
}

// POSIX-relative path of `fullPath` under `baseDir`. Used to mirror a remote subtree under a chosen
// local directory (baseDir = the listing dir the selection sits in).
// e.g. relativeUnder('/a/b', '/a/b/c/d.txt') === 'c/d.txt'
export function relativeUnder(baseDir: string, fullPath: string): string {
  return posixPath.relative(baseDir, fullPath);
}

// True when a download selection contains at least one directory → a recursive download that needs a
// single chosen destination directory. Files-only selections keep the per-file Save-As dialog.
export function selectionNeedsDirPicker(entries: { isDirectory: boolean }[]): boolean {
  return entries.some((e) => e.isDirectory);
}

// One dropped local source, already lstat'd / walked by the fs layer. For a directory source,
// `dirRels` are the POSIX-relative dir paths (incl '' for the root) and `files[].rel` are the
// POSIX-relative file paths under the root. For a file source, `dirRels` is [] and `files` holds a
// single entry with rel ''.
export interface UploadSource {
  baseName: string;
  isDirectory: boolean;
  dirRels: string[];
  files: { rel: string; localPath: string; size: number }[];
}

// A single file to upload: where it is locally, where it goes remotely, plus the basename used for
// the conflict dialog and the progress strip.
export interface PlannedUploadFile {
  localPath: string;
  remotePath: string;
  name: string;
  size: number;
}

// The flattened upload plan: remote dirs to create (parents-first) and files to send.
export interface RemoteUploadPlan {
  dirs: string[];
  files: PlannedUploadFile[];
}

// Map dropped local sources to remote paths under `destDir`. A directory source is mirrored as a
// sub-folder named after its basename (recreating its sub-tree); a file source goes directly into
// `destDir`. Pure POSIX joins (mirrors the component's joinPath = posixPath.join(dir||'/', name)).
export function planRemoteUpload(sources: UploadSource[], destDir: string): RemoteUploadPlan {
  const dirs: string[] = [];
  const files: PlannedUploadFile[] = [];
  const base = destDir || '/';
  for (const s of sources) {
    if (s.isDirectory) {
      const remoteBase = posixPath.join(base, s.baseName);
      for (const rel of s.dirRels) {
        dirs.push(rel ? posixPath.join(remoteBase, rel) : remoteBase);
      }
      for (const f of s.files) {
        files.push({
          localPath: f.localPath,
          remotePath: posixPath.join(remoteBase, f.rel),
          name: posixPath.basename(f.rel) || s.baseName,
          size: f.size,
        });
      }
    } else {
      const f = s.files[0];
      files.push({
        localPath: f.localPath,
        remotePath: posixPath.join(base, s.baseName),
        name: s.baseName,
        size: f.size,
      });
    }
  }
  return { dirs, files };
}
