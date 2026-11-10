/**
 * The Istalang sources a TypeScript test file holds: each literal, or line group, as one source.
 *
 * A literal's text is what it means, its escapes read, and each character maps back to the escape
 * or character spelling it, so an edit lands in the literal's raw text as a spelling of its own. A
 * substitution stands in the source as a name, which reads as an operand wherever a test puts one;
 * the items of a line group stand joined by line breaks. Neither is text any edit may touch.
 *
 * A literal whose raw text doesn't read as what swc read it as (a lone surrogate, which swc keeps
 * as its escape) is skipped and reported, with its group: the rewriter edits only text it reads as
 * the compiler under test would.
 */

import {
  type Embed,
  type Embedding,
  embeddingOf,
  type Piece,
  type Skipped,
} from '../../embedding.ts';
import { cook, spell } from './escapes.ts';
import { type Literal, literalGroupsOf } from './literals.ts';

/** What stands in a source for a template's substitution. */
const substitution = '__substitution__';

const lineBreak: Piece = { kind: 'opaque', text: '\n' };

export const embedTypeScript: Embed = (_path, contents) => {
  const embeddings: Embedding[] = [];
  const skipped: Skipped[] = [];
  for (const group of literalGroupsOf(contents)) {
    const pieces = group.map((literal) => piecesOf(literal, contents));
    const unread = group.find((_, index) => pieces[index] === undefined);
    if (unread === undefined) {
      const joined = pieces.flatMap((literalPieces, index) => [
        ...(index > 0 ? [lineBreak] : []),
        ...(literalPieces ?? []),
      ]);
      embeddings.push(embeddingOf(group[0]?.span.start ?? 0, joined));
    } else {
      skipped.push({
        at: unread.span.start,
        reason: 'its raw text reads otherwise than swc reads it',
      });
    }
  }
  return { embeddings, skipped };
};

/** The pieces of `literal`'s text, or undefined if its raw text doesn't read as swc read it. */
function piecesOf(literal: Literal, contents: string): readonly Piece[] | undefined {
  const pieces: Piece[] = [];
  for (const [index, part] of literal.parts.entries()) {
    const cooked = cook(contents.slice(part.span.start, part.span.end), literal.quote);
    if (cooked === undefined || (part.cooked !== undefined && cooked.text !== part.cooked)) {
      return undefined;
    }
    if (index > 0) {
      pieces.push({ kind: 'opaque', text: substitution });
    }
    pieces.push({
      kind: 'spelled',
      text: cooked.text,
      offsets: cooked.offsets.map((offset) =>
        offset === undefined ? undefined : part.span.start + offset,
      ),
      spell: (text, span) =>
        spell(text, literal.quote, contents[span.start - 1], contents[span.end]),
    });
  }
  return pieces;
}
