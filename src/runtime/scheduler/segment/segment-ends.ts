/**
 * How a segment ends (§5): what it leaves to commit, the root's outcome, or a panic.
 *
 * - A panic is an end, traced where it was thrown unless it brings a trace of its own, a panic
 *   raised again from elsewhere keeping the one it had there.
 * - What a segment leaves must nest no deeper than a snapshot may (limits.ts), checked in the one
 *   walk that finds it, so a value too deep to persist panics the segment instead of committing.
 */

import { depthOf } from '../../../definition/values/values.ts';
import { panicOf } from '../../natives.ts';
import type { HeapObject } from '../../snapshot/objects.ts';
import type { Instance } from '../instance/index.ts';
import { requireDepth } from './limits.ts';
import type { Outcome } from './root-outcome.ts';

export type SegmentEnd =
  /** A driver awaited: commit `objects`, then run the next segment. */
  | { readonly kind: 'awaited'; readonly objects: readonly HeapObject[] }
  /** Nothing is ready: commit `objects`, then wait. */
  | { readonly kind: 'idle'; readonly objects: readonly HeapObject[] }
  /** The root returned: commit its outcome, encoded too when the instance has an encoder. */
  | ({ readonly kind: 'finished' } & Outcome)
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };

/** How a live run's segment ended: a driver awaited, nothing is ready, it finished or panicked. */
export type LiveSegmentEnd =
  | { readonly kind: 'awaited' }
  | { readonly kind: 'idle' }
  | Extract<SegmentEnd, { kind: 'finished' | 'panicked' }>;

/** How a segment ended before what it leaves is checked for persisting. */
export type RunEnd =
  | { readonly kind: 'awaited' }
  | { readonly kind: 'idle' }
  | Extract<SegmentEnd, { kind: 'finished' }>;

/** What `run` gives, or the panic it threw, traced by `trace` where it threw it. */
export function endOrPanic<End>(
  run: () => End,
  trace: () => string,
): End | Extract<SegmentEnd, { kind: 'panicked' }> {
  try {
    return run();
  } catch (error) {
    const panic = panicOf(error);
    if (panic !== undefined) {
      return { kind: 'panicked', message: panic.message, trace: panic.trace ?? trace() };
    }
    throw error;
  }
}

/** `end` of `instance` with what a commit persists; a panic when it holds a value too deep. */
export function persistable(
  instance: Instance,
  end: RunEnd,
): Exclude<SegmentEnd, { kind: 'panicked' }> {
  if (end.kind === 'finished') {
    requireDepth(depthOf(end.outcome));
    if (end.encoded !== undefined) {
      requireDepth(depthOf(end.encoded));
    }
    return end;
  }
  const { objects, depth } = instance.persisted();
  requireDepth(depth);
  return { kind: end.kind, objects };
}
