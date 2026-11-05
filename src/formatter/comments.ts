/**
 * The comments the formatter prints, and how (formatter.md, Decisions): each comment as the source
 * shows it, and the docs that print it before, after or inside its node. Which node it goes to is
 * comment-placement.ts's.
 *
 * A `#` comment always ends its line, so it is either own-line (only whitespace before it) or
 * end-of-line. An own-line comment prints on a line of its own; an end-of-line one at the end of the
 * line its node ends, through a line suffix, so nothing printed after it on that line can be eaten.
 */

import { builders, utils } from 'prettier/doc';
import type { Comment } from '../compiler/syntax/tokens.ts';
import { lineMapOf, lineStartAt, splitLines } from '../text/line-map.ts';
import type { SourceText } from '../text/source-text.ts';
import { type Span, textOf } from '../text/span.ts';

const { breakParent, hardline, lineSuffix, lineSuffixBoundary } = builders;

export interface PlacedComment {
  readonly span: Span;
  readonly text: string;
  /** Only whitespace precedes it on its line. */
  readonly ownLine: boolean;
  /** A blank line separates it from the code or comment before it. */
  readonly blankBefore: boolean;
  /** A blank line separates it from what follows. */
  readonly blankAfter: boolean;
}

export interface CommentsOf {
  readonly leading: readonly PlacedComment[];
  readonly trailing: readonly PlacedComment[];
  readonly dangling: readonly PlacedComment[];
}

/** `comment` as its source shows it. */
export function describeComment(source: SourceText, comment: Comment): PlacedComment {
  const { text } = source;
  const lineStart = lineStartAt(text, comment.span.start);
  return {
    span: comment.span,
    text: textOf(source, comment.span),
    ownLine: text.slice(lineStart, comment.span.start).trim() === '',
    blankBefore: hasBlankLine(text, whitespaceStart(text, comment.span.start), comment.span.start),
    blankAfter: hasBlankLine(text, comment.span.end, whitespaceEnd(text, comment.span.end)),
  };
}

/** The column of `offset`, counted in UTF-16 units from its line's start. */
export function columnOf(source: SourceText, offset: number): number {
  return lineMapOf(source).positionAt(offset).column;
}

const whitespace = /\s/u;

/** Where the whitespace ending at `offset` starts. */
export function whitespaceStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && whitespace.test(text[start - 1] ?? '')) {
    start -= 1;
  }
  return start;
}

/** Where the whitespace starting at `offset` ends. */
function whitespaceEnd(text: string, offset: number): number {
  let end = offset;
  while (end < text.length && whitespace.test(text[end] ?? '')) {
    end += 1;
  }
  return end;
}

/** Whether a line of nothing but whitespace stands between `start` and `end`. */
export function hasBlankLine(text: string, start: number, end: number): boolean {
  return splitLines(text.slice(start, end))
    .slice(1, -1)
    .some((line) => line.trim() === '');
}

/**
 * An end-of-line comment, at the end of the line it is printed on. Another one waiting for that
 * line's end would merge with it into one comment, so a line break comes first then: in brackets,
 * the only place two can meet, as `a # c\n + b # d` printed on one line would put them.
 */
function endOfLineDoc(comment: PlacedComment): builders.Doc {
  return [lineSuffixBoundary, lineSuffix(` ${comment.text}`), breakParent];
}

/** An own-line comment after its node: on the next line, which nothing else is printed on. */
function ownLineAfterDoc(comment: PlacedComment): builders.Doc {
  return [lineSuffix([hardline, comment.blankBefore ? hardline : '', comment.text]), breakParent];
}

/** Comments printed before their node: an own-line one on its line, an end-of-line one after the code. */
export function leadingDocs(comments: readonly PlacedComment[]): builders.Doc[] {
  return comments.map((comment) =>
    comment.ownLine
      ? [comment.text, hardline, comment.blankAfter ? hardline : '']
      : endOfLineDoc(comment),
  );
}

/**
 * Comments printed after their node, `doc`, at the end of its line or on lines of their own. An
 * end-of-line one goes on a line of its own where `doc` or a comment before it already ends that
 * line with one, as `a: # c\n 1, # d` printed as `a: 1 # c` leaves `# d` to the next line.
 */
export function trailingDocs(
  comments: readonly PlacedComment[],
  doc: builders.Doc,
): builders.Doc[] {
  let lineTaken = utils.findInDoc(doc, (part) => (isLineSuffix(part) ? true : undefined), false);
  return comments.map((comment) => {
    if (comment.ownLine || lineTaken) {
      return ownLineAfterDoc(comment);
    }
    lineTaken = true;
    return endOfLineDoc(comment);
  });
}

function isLineSuffix(part: builders.Doc): boolean {
  return typeof part === 'object' && !Array.isArray(part) && part.type === 'line-suffix';
}

/**
 * Comments left to their node, after an opener: an end-of-line one at the end of the opener's
 * line, an own-line one on a line of its own, indented by the caller.
 */
export function danglingDocs(comments: readonly PlacedComment[]): builders.Doc {
  if (comments.length === 0) {
    return '';
  }
  return comments.map((comment) =>
    comment.ownLine ? [hardline, comment.text, breakParent] : endOfLineDoc(comment),
  );
}
