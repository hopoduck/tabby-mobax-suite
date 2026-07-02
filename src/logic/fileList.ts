// Pure file-list logic for the self-built SFTP panel. No Angular/Tabby imports so it stays
// unit-testable under vitest without Electron (mirrors follow.ts / activeSession.ts).

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  mode: number;
}

export interface ClickState {
  name: string;
  at: number;
}

/** Directories first, then case-insensitive name ascending. Returns a new array (no mutation). */
export function sortEntries<T extends FileEntry>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' });
  });
}

/** Case-insensitive substring filter; an empty/whitespace query returns the list unchanged. */
export function applyFilter<T extends FileEntry>(files: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return files;
  }
  return files.filter((file) => file.name.toLowerCase().includes(q));
}

// Extension → FontAwesome class. Kept small and obvious; the panel's own getIcon is not reachable
// (compiled in the host bundle), so we map the common cases ourselves.
const EXT_ICON: Record<string, string> = {
  zip: 'fa-file-archive',
  tar: 'fa-file-archive',
  gz: 'fa-file-archive',
  tgz: 'fa-file-archive',
  bz2: 'fa-file-archive',
  xz: 'fa-file-archive',
  '7z': 'fa-file-archive',
  rar: 'fa-file-archive',
  png: 'fa-file-image',
  jpg: 'fa-file-image',
  jpeg: 'fa-file-image',
  gif: 'fa-file-image',
  svg: 'fa-file-image',
  webp: 'fa-file-image',
  bmp: 'fa-file-image',
  ico: 'fa-file-image',
  pdf: 'fa-file-pdf',
  md: 'fa-file-alt',
  txt: 'fa-file-alt',
  log: 'fa-file-alt',
  json: 'fa-file-code',
  yaml: 'fa-file-code',
  yml: 'fa-file-code',
  xml: 'fa-file-code',
  html: 'fa-file-code',
  css: 'fa-file-code',
  js: 'fa-file-code',
  ts: 'fa-file-code',
  jsx: 'fa-file-code',
  tsx: 'fa-file-code',
  py: 'fa-file-code',
  go: 'fa-file-code',
  rs: 'fa-file-code',
  java: 'fa-file-code',
  c: 'fa-file-code',
  h: 'fa-file-code',
  cpp: 'fa-file-code',
  sh: 'fa-file-code',
  sql: 'fa-file-code',
};

/** FontAwesome class for a list entry: folder / symlink / by-extension / generic file. */
export function iconFor(file: FileEntry): string {
  if (file.isDirectory) {
    return 'fas fa-folder';
  }
  if (file.isSymlink) {
    return 'fas fa-link';
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return `fas ${EXT_ICON[ext] ?? 'fa-file'}`;
}

// FontAwesome bucket → color class. Derived from the glyph iconFor() already chose, so the color
// always matches the icon (and there's one source of truth for the extension → category mapping).
const ICON_COLOR: Record<string, string> = {
  'fa-file-archive': 'mobax-ic-archive',
  'fa-file-image': 'mobax-ic-image',
  'fa-file-pdf': 'mobax-ic-pdf',
  'fa-file-code': 'mobax-ic-code',
  'fa-file-alt': 'mobax-ic-text',
};

/**
 * Category color class for a list entry's icon (e.g. `mobax-ic-folder`). Returns `''` for a generic
 * file so it inherits the default text color. Pairs with `iconFor`; the component appends it to the
 * icon's class list and the CSS gives each class its color.
 */
export function iconColor(file: FileEntry): string {
  if (file.isDirectory) {
    return 'mobax-ic-folder';
  }
  if (file.isSymlink) {
    return 'mobax-ic-link';
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return ICON_COLOR[EXT_ICON[ext]] ?? '';
}

const RWX = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];

/** POSIX `drwxr-xr-x`-style 10-char permission string from the entry's type + mode bits. */
export function modeString(file: FileEntry): string {
  const type = file.isSymlink ? 'l' : file.isDirectory ? 'd' : '-';
  const owner = RWX[(file.mode >> 6) & 0o7];
  const group = RWX[(file.mode >> 3) & 0o7];
  const other = RWX[file.mode & 0o7];
  return `${type}${owner}${group}${other}`;
}

/**
 * Classify a click as single or double. A double is the same entry re-clicked within `doubleMs`.
 * The component holds the returned `state` and feeds it back on the next click (pure — no timers).
 */
export function classifyClick(
  prev: ClickState | null,
  name: string,
  now: number,
  doubleMs = 400,
): { type: 'single' | 'double'; state: ClickState } {
  const isDouble = !!prev && prev.name === name && now - prev.at <= doubleMs;
  return { type: isDouble ? 'double' : 'single', state: { name, at: now } };
}
