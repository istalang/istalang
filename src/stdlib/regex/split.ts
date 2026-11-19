/**
 * `regex.split` (§19.2), JavaScript's algorithm without capture groups. re2js's own `split` follows
 * Java's, which drops trailing empty strings; JavaScript's keeps them, as `strings.split` does.
 */

import type { RE2JS } from 're2js';

/**
 * `s` split around the matches of `program`, as JavaScript's `split` does: a match splits only
 * where it ends past the last split, so an empty match never splits at the start, at the end, or
 * right after another match; and an empty string splits into nothing when the pattern matches it.
 */
export function split(program: RE2JS, s: string): string[] {
  if (s === '') {
    return program.test(s) ? [] : [s];
  }
  const pieces: string[] = [];
  let pieceStart = 0;
  for (const found of program.matchAll(s)) {
    const start = found.index ?? 0;
    const end = start + (found[0] ?? '').length;
    if (start < s.length && end > pieceStart) {
      pieces.push(s.slice(pieceStart, start));
      pieceStart = end;
    }
  }
  pieces.push(s.slice(pieceStart));
  return pieces;
}
