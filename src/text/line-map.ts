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

export class LineMap {
  readonly #lineStarts: readonly number[];
  /** Where each line's content ends, before its line break. */
  readonly #lineEnds: readonly number[];
  readonly #length: number;

  constructor(text: string) {
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
    if (position.line < 0) {
      return 0;
    }
    if (position.line >= this.lineCount) {
      return this.#length;
    }
    const lineEnd = this.#lineEnds[position.line] ?? this.#length;
    return Math.min(this.#startOf(position.line) + Math.max(position.column, 0), lineEnd);
  }

  #startOf(line: number): number {
    return this.#lineStarts[line] ?? this.#length;
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
