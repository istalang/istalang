/**
 * Istalang text some file holds, and how the file spells it: the one map from an edit of the
 * Istalang text to the edit of the file that makes it, whatever kind of file holds the text.
 *
 * A source is joined from pieces. A spelled piece is text the file writes out, and records, for
 * each boundary between its characters, the file offset where that boundary falls; an escape that
 * spells two UTF-16 units leaves the boundary between them nowhere. An opaque piece is text the
 * rewriter puts in for something the file holds as code of its own (a template's `${…}`) or not at
 * all (the line break between the strings of a line group): no edit may touch it.
 *
 * An edit is made in the file only when it lies inside one spelled piece, boundary to boundary, and
 * the file can spell its new text there. Anything else is refused with its reason, never guessed.
 */

import type { Span } from '../../src/foundation/text/span.ts';
import type { Edit } from './pass.ts';

/** How a file spells `text` in place of its own text under `span`; undefined if it can't. */
type Spell = (text: string, span: Span) => string | undefined;

export type Piece =
  | {
      readonly kind: 'spelled';
      readonly text: string;
      /** The file offset of each boundary of `text`, `text.length + 1` of them. */
      readonly offsets: readonly (number | undefined)[];
      readonly spell: Spell;
    }
  | { readonly kind: 'opaque'; readonly text: string };

/** A spelled piece, placed in its source's text. */
interface Spelling {
  /** Where the piece starts in the source's text. */
  readonly from: number;
  readonly offsets: readonly (number | undefined)[];
  readonly spell: Spell;
}

/** Istalang text a file holds. */
export interface Embedding {
  /** The file offset the source starts at, which reports point to. */
  readonly at: number;
  readonly text: string;
  readonly spellings: readonly Spelling[];
}

/** Text a file holds that the rewriter leaves alone, because it can't read it faithfully. */
export interface Skipped {
  readonly at: number;
  readonly reason: string;
}

/** What one file holds: its sources, and what it can't read as one. */
interface Embedded {
  readonly embeddings: readonly Embedding[];
  readonly skipped: readonly Skipped[];
}

/** The sources a file holds, given its path and contents. */
export type Embed = (path: string, contents: string) => Embedded;

/** The source joined from `pieces`, starting at file offset `at`. */
export function embeddingOf(at: number, pieces: readonly Piece[]): Embedding {
  let text = '';
  const spellings: Spelling[] = [];
  for (const piece of pieces) {
    if (piece.kind === 'spelled') {
      spellings.push({ from: text.length, offsets: piece.offsets, spell: piece.spell });
    }
    text += piece.text;
  }
  return { at, text, spellings };
}

/** Text the file writes out as it is, from file offset `start` on. */
export function verbatim(text: string, start: number): Piece {
  return {
    kind: 'spelled',
    text,
    offsets: Array.from({ length: text.length + 1 }, (_, offset) => start + offset),
    spell: (replacement) => replacement,
  };
}

/** The edit of the file that makes `edit` in `embedding`'s text, or why the file can't make it. */
export function fileEditOf(embedding: Embedding, edit: Edit): Edit | { readonly refusal: string } {
  const { start, end } = edit.span;
  const spelling = embedding.spellings.find(
    ({ from, offsets }) => from <= start && end < from + offsets.length,
  );
  if (spelling === undefined) {
    return { refusal: 'it touches a substitution, or the line break joining two strings' };
  }
  const fileStart = spelling.offsets[start - spelling.from];
  const fileEnd = spelling.offsets[end - spelling.from];
  if (fileStart === undefined || fileEnd === undefined) {
    return { refusal: 'it splits what one escape spells' };
  }
  const span = { start: fileStart, end: fileEnd };
  const text = spelling.spell(edit.text, span);
  return text === undefined ? { refusal: 'the file cannot spell its text there' } : { span, text };
}
