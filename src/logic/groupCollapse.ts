/**
 * Pure set helpers for which session folders are expanded.
 * The persisted state is the EXPANDED set, so an empty list means
 * "all collapsed" — the desired default and the correct state for a new group.
 */
export function isExpanded(keys: string[], key: string): boolean {
  return keys.includes(key);
}

export function toggleExpanded(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}
