/**
 * How a multi-line literal's lines become its value (§2): one rule for templates and docstrings.
 *
 * - A line break in the source is `\n` in the value, whichever break the source uses.
 * - If the opening delimiter ends its line, that line break goes; so does the one before a closing
 *   delimiter standing alone on its line, with the spaces before it.
 * - Every line after the first loses the leading spaces they all share; a blank line doesn't count
 *   towards that. The opening line keeps what it holds, so `` `a ${x}` `` stays literal.
 *
 * Indentation is decided on the source, before escapes are decoded: an escaped `\n` or `\t` is
 * content, never a line break or indentation. So a literal arrives here as pieces, and a template's
 * values only split its text: a line holding one isn't blank.
 */

/** One piece of a literal's text, before its lines are laid out. */
export type LinePiece =
  /** Source characters, with no line break among them. */
  | { readonly kind: 'text'; readonly text: string }
  /** A decoded escape: content, never indentation. */
  | { readonly kind: 'escape'; readonly text: string }
  /** A line break in the source. */
  | { readonly kind: 'break' };

type Pieces = readonly LinePiece[];

/** A literal's pieces as its scanner reads them: runs of plain characters, and what breaks them. */
export class PieceReader {
  readonly #text: string;
  readonly #pieces: LinePiece[] = [];
  #runStart: number;

  /** Reads `text` from `start`, where the literal's text begins. */
  constructor(text: string, start: number) {
    this.#text = text;
    this.#runStart = start;
  }

  /** Adds a piece that isn't plain text at `offset`, after which plain text resumes at `next`. */
  add(piece: LinePiece, offset: number, next: number): void {
    this.#endRun(offset);
    this.#pieces.push(piece);
    this.#runStart = next;
  }

  /** The pieces read, the last run of plain characters ending at `offset`. */
  piecesUpTo(offset: number): readonly LinePiece[] {
    this.#endRun(offset);
    return this.#pieces;
  }

  #endRun(offset: number): void {
    if (offset > this.#runStart) {
      this.#pieces.push({ kind: 'text', text: this.#text.slice(this.#runStart, offset) });
    }
    this.#runStart = offset;
  }
}

const blankText = /^[ \t]*$/u;
const leadingSpaces = /^ */u;

/** Each text of a literal, laid out (§2): `texts` are what stands around its values, in order. */
export function layOutLines(texts: readonly Pieces[]): readonly string[] {
  const first = texts[0] ?? [];
  const last = texts.at(-1) ?? [];
  const dropsOpening = isBlankBetween(first, 0, first.findIndex(isBreak));
  const lastBreak = last.findLastIndex(isBreak);
  const dropsClosing = lastBreak >= 0 && isBlankBetween(last, lastBreak + 1, last.length);
  const indentation = sharedIndentation(texts);
  return texts.map((pieces, index) => {
    const from = index === 0 && dropsOpening ? pieces.findIndex(isBreak) + 1 : 0;
    const to = index === texts.length - 1 && dropsClosing ? lastBreak : pieces.length;
    return decode(pieces.slice(from, Math.max(from, to)), indentation, from > 0);
  });
}

function isBreak(piece: LinePiece): boolean {
  return piece.kind === 'break';
}

/** Whether pieces `from` to `to` (exclusive) hold only spaces and tabs; false when `to` is -1. */
function isBlankBetween(pieces: Pieces, from: number, to: number): boolean {
  return to >= 0 && pieces.slice(from, to).every((piece) => isBlankText(piece));
}

function isBlankText(piece: LinePiece): boolean {
  return piece.kind === 'text' && blankText.test(piece.text);
}

/** The leading spaces every non-blank line after the first shares. */
function sharedIndentation(texts: readonly Pieces[]): number {
  let shared: number | undefined;
  for (const [index, pieces] of texts.entries()) {
    for (const [at, piece] of pieces.entries()) {
      const indentation =
        piece.kind === 'break'
          ? lineIndentation(pieces, at + 1, index === texts.length - 1)
          : undefined;
      if (indentation !== undefined) {
        shared = Math.min(shared ?? indentation, indentation);
      }
    }
  }
  return shared ?? 0;
}

/**
 * The leading spaces of the line starting at `from`, or undefined for a blank one. A line that
 * runs into a template's value isn't blank; one that ends at the closing delimiter may be.
 */
function lineIndentation(pieces: Pieces, from: number, isLastText: boolean): number | undefined {
  const end = pieces.findIndex((piece, at) => at >= from && piece.kind === 'break');
  const line = pieces.slice(from, end < 0 ? pieces.length : end);
  if (line.every(isBlankText) && (end >= 0 || isLastText)) {
    return undefined;
  }
  const leading = line.findIndex((piece) => !isBlankText(piece));
  const blankRun = line.slice(0, leading < 0 ? line.length : leading);
  const next = leading < 0 ? undefined : line[leading];
  const text = blankRun.map((piece) => (piece.kind === 'text' ? piece.text : '')).join('');
  const run = next?.kind === 'text' ? text + next.text : text;
  return leadingSpaceCount(run);
}

/** The pieces' text, each line after a break losing up to `indentation` leading spaces. */
function decode(pieces: Pieces, indentation: number, startsAfterBreak: boolean): string {
  let value = '';
  let toRemove = startsAfterBreak ? indentation : 0;
  for (const piece of pieces) {
    if (piece.kind === 'break') {
      value += '\n';
      toRemove = indentation;
    } else if (piece.kind === 'escape') {
      value += piece.text;
      toRemove = 0;
    } else {
      const removed = Math.min(toRemove, leadingSpaceCount(piece.text));
      value += piece.text.slice(removed);
      toRemove = removed === piece.text.length ? toRemove - removed : 0;
    }
  }
  return value;
}

function leadingSpaceCount(text: string): number {
  return leadingSpaces.exec(text)?.[0].length ?? 0;
}
