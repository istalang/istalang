/**
 * Longest-match lookup of punctuators.
 *
 * The lookup table is derived from the punctuator list in syntax/tokens.ts, so adding a punctuator
 * there is enough. There is deliberately no `>>` (the language has no shift operators), so
 * `Array<Array<int>>` closes two type-argument lists without the parser splitting a token.
 */

import { type Punctuator, punctuators } from '../syntax/tokens.ts';

const candidatesByFirstChar: ReadonlyMap<string, readonly Punctuator[]> = Map.groupBy(
  [...punctuators].sort((left, right) => right.length - left.length),
  (punctuator) => punctuator.charAt(0),
);

/** The longest punctuator starting at `offset`, if any. */
export function matchPunctuator(text: string, offset: number): Punctuator | undefined {
  const candidates = candidatesByFirstChar.get(text.charAt(offset));
  return candidates?.find((punctuator) => text.startsWith(punctuator, offset));
}
