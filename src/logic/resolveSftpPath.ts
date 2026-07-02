// Pure logic for bridging a shell-namespace path to the SFTP server's namespace.
//
// On servers that chroot/virtual-root the SFTP subsystem (e.g. Synology, where the shell sees
// `/volume3/web/share` but the SFTP channel exposes that same directory as `/web/share`), a path
// typed/followed from the shell side fails `readdir` with NoSuchFile. There is no protocol way to
// learn the chroot relationship, so we resolve empirically: try progressively shorter trailing
// sub-paths and keep the first one the server actually lists ("probe-and-verify"). This module is
// the pure half — candidate generation + the learned prefix mapping; the SFTP probing (I/O) lives
// in the component. No Angular/Tabby imports so it stays vitest-testable.

/** Split an absolute-ish path into non-empty segments (collapses // and trailing /). */
function segments(p: string): string[] {
  return p.split('/').filter((s) => s.length > 0);
}

/**
 * Ordered fallback paths to try when `input` itself failed to list: the input with leading
 * segments progressively stripped, longest (most specific) suffix first. Excludes `input` itself
 * and never yields `/` (root almost always lists, so it would falsely "resolve" any wrong path).
 *
 *   '/volume3/web/share' -> ['/web/share', '/share']
 *   '/web'               -> []   (nothing to strip)
 */
export function pathCandidates(input: string): string[] {
  const parts = segments(input);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push('/' + parts.slice(i).join('/'));
  }
  return out;
}

/** A learned shell->SFTP rewrite: strip leading `from`, prepend `to` (usually '' = SFTP root). */
export interface PrefixMapping {
  from: string;
  to: string;
}

/**
 * Given the path that failed (`input`) and the trailing sub-path that succeeded (`resolved`),
 * derive the reusable prefix rewrite. `resolved` must be a whole-segment suffix of `input`
 * (which is exactly how pathCandidates builds them); returns null otherwise.
 *
 *   derive('/volume3/web/share', '/web/share') -> { from: '/volume3', to: '' }
 */
export function derivePrefixMapping(input: string, resolved: string): PrefixMapping | null {
  const inSegs = segments(input);
  const resSegs = segments(resolved);
  if (resSegs.length === 0 || resSegs.length >= inSegs.length) {
    return null;
  }
  const start = inSegs.length - resSegs.length;
  for (let k = 0; k < resSegs.length; k++) {
    if (inSegs[start + k] !== resSegs[k]) {
      return null;
    }
  }
  return { from: '/' + inSegs.slice(0, start).join('/'), to: '' };
}

/**
 * Apply a learned mapping up front so a same-namespace path resolves in a single readdir (no
 * re-probing). Idempotent: a path already in the SFTP namespace is returned unchanged, so feeding
 * a mapped path back through is a no-op (prevents navigation loops).
 *
 *   apply('/volume3/web/share', { from: '/volume3', to: '' }) -> '/web/share'
 *   apply('/web/share',         { from: '/volume3', to: '' }) -> '/web/share'  (unchanged)
 */
export function applyPrefixMapping(input: string, mapping: PrefixMapping): string {
  const { from, to } = mapping;
  if (!from || from === '/') {
    return input;
  }
  if (input === from) {
    return to || '/';
  }
  if (input.startsWith(from + '/')) {
    const mapped = to + input.slice(from.length); // slice keeps the leading '/'
    return mapped.startsWith('/') ? mapped : '/' + mapped;
  }
  return input;
}
