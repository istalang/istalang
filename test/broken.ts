/**
 * Valid texts broken at random, for the totality properties of every phase that starts from
 * source: whole lines or single tokens deleted, duplicated or swapped.
 *
 * Breaking real programs reaches error paths a random soup rarely does: an import that lost its
 * path, a block that lost its header, a declaration repeated far from the first.
 */

import fc from 'fast-check';
import { scan } from '../src/compiler/scanner/scan.ts';
import { createSourceText } from '../src/foundation/text/source-text.ts';

interface Mutation {
  readonly kind: 'delete' | 'duplicate' | 'swap';
  readonly at: number;
  readonly to: number;
}

const mutation = fc.record({
  kind: fc.constantFrom('delete', 'duplicate', 'swap'),
  at: fc.nat(),
  to: fc.nat(),
}) satisfies fc.Arbitrary<Mutation>;

/** One of `texts`, with up to four random changes to its lines or to its tokens. */
export function brokenText(texts: readonly string[]): fc.Arbitrary<string> {
  return fc
    .record({
      text: fc.constantFrom(...texts),
      byLines: fc.boolean(),
      changes: fc.array(mutation, { minLength: 1, maxLength: 4 }),
    })
    .map(({ text, byLines, changes }) => {
      const pieces = byLines ? text.split('\n') : tokenPieces(text);
      const broken = changes.reduce<string[]>((current, change) => mutate(current, change), pieces);
      return broken.join(byLines ? '\n' : '');
    });
}

/** Applies `change` to `pieces`, wrapping its positions into range. */
function mutate(pieces: readonly string[], change: Mutation): string[] {
  const result = [...pieces];
  if (result.length === 0) {
    return result;
  }
  const at = change.at % result.length;
  const to = change.to % result.length;
  const piece = result[at] ?? '';
  switch (change.kind) {
    case 'delete':
      result.splice(at, 1);
      break;
    case 'duplicate':
      result.splice(to, 0, piece);
      break;
    default:
      result[at] = result[to] ?? '';
      result[to] = piece;
  }
  return result;
}

/** The text cut into tokens, each with the whitespace and comments before it. */
function tokenPieces(text: string): string[] {
  const { tokens } = scan(createSourceText('example.ista', text));
  return tokens.map((token, index) => text.slice(tokens[index - 1]?.span.end ?? 0, token.span.end));
}
