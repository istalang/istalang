/**
 * Random text built from given fragments, for the totality properties of every phase.
 *
 * Each phase supplies its own fragments: valid pieces, broken ones and hostile characters, so a
 * property explores error paths as well as happy ones. Separators decide which line breaks and
 * indentation the soup holds.
 */

import fc from 'fast-check';

/** Up to `maxLength` fragments, each followed by a separator, all picked at random. */
export function soupOf(
  fragments: readonly string[],
  separators: readonly string[],
  maxLength: number,
): fc.Arbitrary<string> {
  return fc
    .array(fc.tuple(fc.constantFrom(...fragments), fc.constantFrom(...separators)), { maxLength })
    .map((pairs) => pairs.map(([fragment, separator]) => fragment + separator).join(''));
}
