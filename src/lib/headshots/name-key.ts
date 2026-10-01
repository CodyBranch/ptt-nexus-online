/**
 * The key a headshot is matched on: "last|first", letters only, lower case,
 * accents off. "O'Brien" and "OBrien" are one runner, and so are "José" and
 * "Jose"; the order of the two names is kept, so Jordan Casey is not Casey
 * Jordan.
 *
 * The desk app computes the same key (src/shared/headshots/name-key.ts there);
 * change one and the other with it.
 */
export function headshotNameKey(first: string, last: string): string {
  const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  return `${clean(last)}|${clean(first)}`;
}

/** The fall year of a season label: "2026-27", "2026", "2026-2027" -> 2026. */
export function seasonYear(label: string | number | null | undefined): number | null {
  const m = /(\d{4})/.exec(String(label ?? ''));
  return m ? Number(m[1]) : null;
}
