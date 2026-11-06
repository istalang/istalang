/**
 * The limits a program runs into as panics (§3.12):
 * - A string, an array or an integer larger than JavaScript can hold is a limit, not a bug, so
 *   whatever native or instruction builds one panics. The engine says so only with a RangeError
 *   and its message, so the messages are matched here, the one place that reads them; any other
 *   RangeError is a bug and propagates.
 * - A persisted value nests at most `maximumDepth` levels (definition/values/values.ts). A segment
 *   leaving a deeper value, where an execution can reach it or as its outcome, panics where it
 *   ended instead, so it commits nothing (§5).
 * - A segment has at most `maximumFrames` frames running at once across its run stack: enough for
 *   deep recursion in heap frames (test/corpus/run/recursion.ista runs 100,000 frames deep), while
 *   stopping unbounded recursion before it exhausts the host's memory.
 */

import { maximumDepth } from '../../../definition/values/values.ts';
import { Panic } from '../../natives.ts';

/** What each limit's RangeError says, as V8 words it, and what the panic says instead. */
const limits = new Map([
  ['Invalid string length', 'The string would be longer than the runtime can hold.'],
  ['Invalid array length', 'The array would be longer than the runtime can hold.'],
  ['Maximum BigInt size exceeded', 'The integer would be larger than the runtime can hold.'],
]);

/** The panic `error` stands for: a Panic itself, or one for a limit the program ran into. */
export function panicOf(error: unknown): Panic | undefined {
  if (error instanceof Panic) {
    return error;
  }
  const limit = error instanceof RangeError ? limits.get(error.message) : undefined;
  return limit === undefined ? undefined : new Panic(limit, { cause: error });
}

/** The most frames a segment may have running at once. */
const maximumFrames = 200_000;

/** Panics when a value nesting `depth` levels is too deep to persist (§5). */
export function requireDepth(depth: number): void {
  if (depth > maximumDepth) {
    throw new Panic(
      `A value nests ${depth} levels deep, deeper than the ${maximumDepth} an instance can persist.`,
    );
  }
}

/** Panics when a call would exceed `maximumFrames` running frames. */
export function requireFrameDepth(frames: number): void {
  if (frames > maximumFrames) {
    throw new Panic(
      `A call nests ${frames} frames deep, deeper than the ${maximumFrames} allowed.`,
    );
  }
}
