/**
 * The limits a program runs into as panics (§3.12):
 * - A string, an array or an integer larger than JavaScript can hold is a limit, not a bug, so
 *   whatever native or instruction builds one panics: `panicOf` (../../natives.ts) reads the
 *   engine's RangeError, for every runtime.
 * - A persisted value nests at most `maximumDepth` levels (definition/values/values.ts). A segment
 *   leaving a deeper value, where an execution can reach it or as its outcome, panics where it
 *   ended instead, so it commits nothing (§5).
 * - A segment has at most `maximumFrames` frames running at once across its run stack: far past
 *   the 1,000 nested calls the spec guarantees (§5), while stopping unbounded recursion before it
 *   exhausts the host's memory.
 */

import { maximumDepth } from '../../../definition/values/values.ts';
import { Panic } from '../../natives.ts';

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
