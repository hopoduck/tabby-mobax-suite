// Pure move-planning for SFTP drag-and-drop. No Angular/Tabby/Node imports so it stays
// unit-testable under vitest. POSIX paths are joined by hand (the SFTP protocol is POSIX).

export interface DraggedItem {
  name: string;
  fullPath: string;
  isDirectory: boolean;
}

export type SkipReason = 'sameDir' | 'self' | 'collision';

export interface MovePlan {
  moves: { from: string; to: string }[];
  skipped: { name: string; reason: SkipReason }[];
}

/** POSIX join: collapse a trailing slash on dir, then `dir/name`; root stays `/name`. */
function joinPosix(dir: string, name: string): string {
  const base = dir === '/' ? '' : dir.replace(/\/+$/, '');
  return `${base}/${name}`;
}

/** Parent dir of an absolute POSIX path; the parent of a top-level entry is `/`. */
function parentOf(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i <= 0 ? '/' : trimmed.slice(0, i);
}

/**
 * Plan rename operations to move `items` into `targetDir`.
 * Skips: items already in `targetDir` (sameDir), a folder moved into itself or a descendant
 * (self), and names that already exist in the target (collision). The `..` shortcut is ignored.
 */
export function planMoves(
  items: DraggedItem[],
  targetDir: string,
  existingNames: Set<string>,
): MovePlan {
  const moves: { from: string; to: string }[] = [];
  const skipped: { name: string; reason: SkipReason }[] = [];
  for (const it of items) {
    if (it.name === '..') {
      continue;
    }
    const from = it.fullPath;
    if (parentOf(from) === targetDir) {
      skipped.push({ name: it.name, reason: 'sameDir' });
      continue;
    }
    const fromTrimmed = from.replace(/\/+$/, '');
    if (it.isDirectory && (targetDir === fromTrimmed || targetDir.startsWith(`${fromTrimmed}/`))) {
      skipped.push({ name: it.name, reason: 'self' });
      continue;
    }
    if (existingNames.has(it.name)) {
      skipped.push({ name: it.name, reason: 'collision' });
      continue;
    }
    moves.push({ from, to: joinPosix(targetDir, it.name) });
  }
  return { moves, skipped };
}
