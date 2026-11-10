/**
 * Applying edits to a text: the one place that orders them and refuses overlapping ones, for an
 * Istalang source's text and for a file's alike.
 *
 * Edits are ordered by where they start, an insertion before a replacement starting where it
 * does. Insertions at one offset keep the order they are given in, which a pass decides, as when
 * two nested rewrites close at one point. Two edits replacing text they share have no order that
 * means anything, so they are a pass's error and throw.
 */

import type { Edit } from './pass.ts';

/** `edits` in text order; throws on two that overlap. */
export function inTextOrder(edits: readonly Edit[]): readonly Edit[] {
  const ordered = edits.toSorted(
    (first, second) => first.span.start - second.span.start || first.span.end - second.span.end,
  );
  for (const [index, edit] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous !== undefined && overlap(previous, edit)) {
      const [first, second] = [previous.span, edit.span];
      throw new Error(
        `Edits overlap at ${first.start}–${first.end} and ${second.start}–${second.end}.`,
      );
    }
  }
  return ordered;
}

function overlap(first: Edit, second: Edit): boolean {
  return second.span.start < first.span.end;
}

/** `text` with `edits` made; throws on two that overlap. */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let result = '';
  let copied = 0;
  for (const { span, text: replacement } of inTextOrder(edits)) {
    result += text.slice(copied, span.start) + replacement;
    copied = span.end;
  }
  return result + text.slice(copied);
}
