/**
 * The lines edits change in a text, as they read before and after, for a person to review. Edits on
 * one line or on touching lines show as one hunk, so a rewrite spanning lines reads whole.
 */

import { LineMap, splitLines } from '../../src/foundation/text/line-map.ts';
import { applyEdits, inTextOrder } from './edits.ts';
import type { Edit } from './pass.ts';

export interface Hunk {
  /** The one-based line the hunk starts on. */
  readonly line: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

/** The hunks `edits` make in `before`. */
export function hunksOf(before: string, edits: readonly Edit[]): readonly Hunk[] {
  const lineMap = new LineMap(before);
  const ranges: { first: number; last: number; edits: Edit[] }[] = [];
  for (const edit of inTextOrder(edits)) {
    const first = lineMap.positionAt(edit.span.start).line;
    const last = lineMap.positionAt(edit.span.end).line;
    const current = ranges.at(-1);
    if (current !== undefined && first <= current.last + 1) {
      current.last = Math.max(current.last, last);
      current.edits.push(edit);
    } else {
      ranges.push({ first, last, edits: [edit] });
    }
  }
  return ranges.map(({ first, last, edits: inRange }) => {
    const { start } = lineMap.lineSpan(first);
    const lines = before.slice(start, lineMap.lineSpan(last).end);
    const shifted = inRange.map(({ span, text }) => ({
      span: { start: span.start - start, end: span.end - start },
      text,
    }));
    return {
      line: first + 1,
      removed: splitLines(lines),
      added: splitLines(applyEdits(lines, shifted)),
    };
  });
}
