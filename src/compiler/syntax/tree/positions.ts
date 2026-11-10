/**
 * Where nodes stand: spans anchored to the segment of text a node belongs to, and the text
 * positions a tree gives them (docs/work/m6-m7/incremental-checking.md, §2).
 *
 * A segment is a stretch of a module's text that an edit elsewhere leaves as it is: a top-level
 * item's or a trait member's header, the body of a top-level or trait-member function, or the
 * module's own, which holds its docstring. A node's span counts from its segment's start, which
 * only the tree knows, so a segment a later parse reuses keeps every span under it, and so does
 * everything keyed by those nodes.
 *
 * An anchored span is not a text `Span`, so the compiler finds every place that needs a text
 * position; those convert through the tree (`spanIn`, and index.ts `extentIn`). Spans of
 * different segments never compare: their offsets count from different starts. The helpers here
 * that join or compare two spans therefore require one segment, and throw on two.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Span } from '../../../foundation/text/span.ts';

/** A segment of a module's text. The object is its identity; a tree gives its start. */
export interface Segment {
  /** What it holds: the module's own text, an item's or a member's header, or a body. */
  readonly kind: 'module' | 'header' | 'body';
}

/** A half-open range [from, to) of UTF-16 offsets from the start of `segment`. */
export interface AnchoredSpan {
  readonly segment: Segment;
  readonly from: number;
  readonly to: number;
}

/** What gives segments their place in a text: the offset each starts at. */
export interface SegmentBases {
  readonly bases: ReadonlyMap<Segment, number>;
}

/** The text positions `span` covers in the text `tree` was parsed from. */
export function spanIn(tree: SegmentBases, span: AnchoredSpan): Span {
  const base = tree.bases.get(span.segment);
  if (base === undefined) {
    return unreachable('A span was read through a tree that does not hold its segment.');
  }
  return { start: base + span.from, end: base + span.to };
}

/** `diagnostic` as it leaves its phase: pointing at text positions in `tree`'s text. */
export function diagnosticIn(tree: SegmentBases, diagnostic: Diagnostic<AnchoredSpan>): Diagnostic {
  return { ...diagnostic, span: spanIn(tree, diagnostic.span) };
}

/** From the start of `first` to the end of `last`, two spans of one segment. */
export function spanAcross(first: AnchoredSpan, last: AnchoredSpan): AnchoredSpan {
  return { segment: segmentOf(first, last), from: first.from, to: last.to };
}

/** The least span covering `first` and every one of `rest`, all of one segment. */
export function spanCovering(first: AnchoredSpan, ...rest: readonly AnchoredSpan[]): AnchoredSpan {
  return rest.reduce(
    (covering, span) => ({
      segment: segmentOf(covering, span),
      from: Math.min(covering.from, span.from),
      to: Math.max(covering.to, span.to),
    }),
    first,
  );
}

/** From the end of `first` to the start of `last`, two spans of one segment: what parts them. */
export function spanBetween(first: AnchoredSpan, last: AnchoredSpan): AnchoredSpan {
  return { segment: segmentOf(first, last), from: first.to, to: last.from };
}

/** The empty span where `span` ends. */
export function endOf(span: AnchoredSpan): AnchoredSpan {
  return { segment: span.segment, from: span.to, to: span.to };
}

/** Whether two spans start at one place: in one segment, at one offset. */
export function startTogether(first: AnchoredSpan, second: AnchoredSpan): boolean {
  return first.segment === second.segment && first.from === second.from;
}

/** Whether `inner` lies wholly within `outer`; never, for spans of different segments. */
export function encloses(outer: AnchoredSpan, inner: AnchoredSpan): boolean {
  return outer.segment === inner.segment && outer.from <= inner.from && inner.to <= outer.to;
}

/** The segment two spans share; they must share one. */
function segmentOf(first: AnchoredSpan, second: AnchoredSpan): Segment {
  if (first.segment !== second.segment) {
    return unreachable('Two spans of different segments were joined.');
  }
  return first.segment;
}
