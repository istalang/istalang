/**
 * A half-open range [start, end) of UTF-16 offsets into a SourceText.
 *
 * Half-open so that adjacent spans share a boundary without overlapping, an empty span (start ===
 * end) marks a position, such as the end of input, and length is end - start.
 */

import type { SourceText } from './source-text.ts';

export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The text a span covers. */
export function textOf(source: SourceText, span: Span): string {
  return source.text.slice(span.start, span.end);
}

/** Whether `inner` lies wholly within `outer`. */
export function encloses(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}
