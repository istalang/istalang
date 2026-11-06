/**
 * Conversion between offsets and zero-based line/column positions.
 *
 * What counts as a line break is defined once, here (§2): `\n`, `\r\n` and a lone `\r`.
 * The scanner uses the same definition, so it can never disagree with the line map about which
 * line a token is on.
 *
 * Columns count UTF-16 code units from the line start, like offsets. Indentation is spaces only
 * (§2), so for leading whitespace a column is also the visual indentation width.
 *
 * A LineMap is derived from its SourceText on first use and memoized by object identity, which is
 * safe because SourceText is immutable. Where only the line starts survive, as in a compiled
 * Definition's modules, `positionIn` finds a position from them alone, by the same search.
 */

import { memo } from '../structures/memo.ts';
import { lastIndexAtMost } from '../structures/sorted.ts';
import type { SourceText } from './source-text.ts';
import type { Span } from './span.ts';

export interface Position {
  readonly line: number;
  readonly column: number;
}

const carriageReturn = '\r';
const lineFeed = '\n';

/** Length of the line break starting at `offset`: 2 for `\r\n`, 1 for `\n` or `\r`, else 0. */
export function lineBreakLength(text: string, offset: number): number {
  const char = text[offset];
  if (char === lineFeed) {
    return 1;
  }
  if (char !== carriageReturn) {
    return 0;
  }
  return text[offset + 1] === lineFeed ? 2 : 1;
}

/** The lines of `text`, without their line breaks; one more than it has breaks. */
export function splitLines(text: string): string[] {
  const { starts, ends } = lineBounds(text);
  return starts.map((start, line) => text.slice(start, ends[line]));
}

/** Where each line of `text` starts, and where its content ends, before its line break. */
function lineBounds(text: string): { readonly starts: number[]; readonly ends: number[] } {
  const starts = [0];
  const ends: number[] = [];
  let offset = 0;
  while (offset < text.length) {
    const breakLength = lineBreakLength(text, offset);
    if (breakLength > 0) {
      ends.push(offset);
      starts.push(offset + breakLength);
    }
    offset += Math.max(breakLength, 1);
  }
  ends.push(text.length);
  return { starts, ends };
}

/** Where the line holding `offset` starts: just past the line break before it, or 0. */
export function lineStartAt(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && lineBreakLength(text, start - 1) === 0) {
    start -= 1;
  }
  return start;
}

const leadingSpaces = /^ */u;

/** How many spaces `text` starts with: its indentation, when it is a line. */
export function leadingSpaceCount(text: string): number {
  return leadingSpaces.exec(text)?.[0].length ?? 0;
}

/** The indentation of the line `offset` is on: the spaces opening it, up to `offset`. */
export function indentationAt(text: string, offset: number): number {
  return leadingSpaceCount(text.slice(lineStartAt(text, offset), offset));
}

export class LineMap {
  readonly #lineStarts: readonly number[];
  /** Where each line's content ends, before its line break. */
  readonly #lineEnds: readonly number[];
  readonly #length: number;

  constructor(text: string) {
    const { starts, ends } = lineBounds(text);
    this.#lineStarts = starts;
    this.#lineEnds = ends;
    this.#length = text.length;
  }

  get lineCount(): number {
    return this.#lineStarts.length;
  }

  /** The offset each line starts at, the first line's at 0. */
  get lineStarts(): readonly number[] {
    return this.#lineStarts;
  }

  /** Position of an offset; offsets outside the text are clamped to it. */
  positionAt(offset: number): Position {
    return positionIn(this.#lineStarts, Math.min(Math.max(offset, 0), this.#length));
  }

  /**
   * Offset of a position. As LSP clients expect, a column past its line's end means that end
   * (before the break), and a line past the last one means the end of the text.
   */
  offsetAt(position: Position): number {
    const { start, end } = this.lineSpan(position.line);
    return Math.min(start + Math.max(position.column, 0), end);
  }

  /**
   * The text line `line` holds, without its line break. As for `offsetAt`, a line before the first
   * is empty at the start of the text, and a line past the last at its end.
   */
  lineSpan(line: number): Span {
    return line < 0
      ? { start: 0, end: 0 }
      : {
          start: this.#lineStarts[line] ?? this.#length,
          end: this.#lineEnds[line] ?? this.#length,
        };
  }
}

const lineMaps = new WeakMap<SourceText, LineMap>();

/** The line map of a source, computed once per SourceText object. */
export function lineMapOf(source: SourceText): LineMap {
  return memo(lineMaps, source, () => new LineMap(source.text));
}

/** The position of `offset` among lines starting at `lineStarts` (ascending, the first at 0). */
export function positionIn(lineStarts: readonly number[], offset: number): Position {
  const line = Math.max(
    lastIndexAtMost(lineStarts, (start) => start, offset),
    0,
  );
  return { line, column: offset - (lineStarts[line] ?? 0) };
}
