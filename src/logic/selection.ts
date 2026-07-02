// Pure selection logic for the SFTP file list. No Angular/Tabby imports so it stays
// unit-testable under vitest without Electron (mirrors fileList.ts / follow.ts).

/**
 * Inclusive range of names between `anchor` and `target` within `visibleNames`, in list order.
 * Order-independent (anchor may sit before or after target). Falls back to just `[target]` when
 * there is no anchor or a name is not in the list.
 */
export function rangeNames(
  visibleNames: string[],
  anchor: string | null,
  target: string,
): string[] {
  if (!anchor) {
    return [target];
  }
  const a = visibleNames.indexOf(anchor);
  const b = visibleNames.indexOf(target);
  if (a === -1 || b === -1) {
    return [target];
  }
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return visibleNames.slice(lo, hi + 1);
}

export interface RowRect {
  name: string;
  top: number;
  bottom: number;
}

export interface Span {
  top: number;
  bottom: number;
}

/** Names whose vertical span overlaps the marquee span (single-column list → vertical only). */
export function rowsInMarquee(rows: RowRect[], rect: Span): string[] {
  return rows.filter((r) => r.top < rect.bottom && r.bottom > rect.top).map((r) => r.name);
}

/**
 * The name reached by stepping `delta` rows from `current` within `names`, clamped to the ends.
 * Drives ArrowUp/Down (±1), PageUp/Down (±page). With no current (or an absent one), a forward
 * step lands on the first row and a backward step on the last. Empty list → null.
 */
export function stepName(names: string[], current: string | null, delta: number): string | null {
  if (names.length === 0) {
    return null;
  }
  const idx = current === null ? -1 : names.indexOf(current);
  if (idx === -1) {
    return delta >= 0 ? names[0] : names[names.length - 1];
  }
  const next = Math.min(names.length - 1, Math.max(0, idx + delta));
  return names[next];
}
