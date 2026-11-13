/**
 * A prelude `Range`'s values (§3.8): which ints it reaches, for iteration, membership, slicing
 * (positions.ts) and random draws alike. One home, so they can't disagree.
 *
 * - A range is read through its declaration, by its fields' names (values/arguments.ts).
 * - The step's sign is the direction, and the end is never reached: `..=` stored its end one past
 *   the written one in that direction. A range whose end lies the other way reaches nothing, as
 *   Python's `range` does. A step of 0 would reach its start forever, which is a bug in the
 *   program, so it panics (§3.12).
 * - An open start or end reaches without bound that way; only a range with both ends can be
 *   counted, and only one with a start can step by more than 1.
 */

import { fieldValueOf } from '../definition/values/declared-values.ts';
import type { Value } from '../definition/values/values.ts';
import { type NativeContext, Panic } from '../runtime/natives.ts';
import { int, optionalInt } from './values/arguments.ts';

/** A range as natives read it: its ends, each undefined when open, and its step, never 0. */
export interface RangeValue {
  readonly start: bigint | undefined;
  readonly end: bigint | undefined;
  readonly step: bigint;
}

/** The prelude `Range` `range` is. */
export function rangeOf(
  context: Pick<NativeContext, 'types'>,
  range: Value | undefined,
): RangeValue {
  const end = (name: string) => optionalInt(context, fieldValueOf(context.types, range, name));
  const read = {
    start: end('start'),
    end: end('end'),
    step: int(fieldValueOf(context.types, range, 'step')),
  };
  if (read.step === 0n) {
    throw new Panic(`The range ${textOf(read)} has a step of 0.`);
  }
  return read;
}

/** A range with both ends. */
interface BoundedRange {
  readonly start: bigint;
  readonly end: bigint;
  readonly step: bigint;
}

/** `range` with both ends; `doing` names what needs them in the panic of an open one. */
export function bounded(range: RangeValue, doing: string): BoundedRange {
  const { start, end } = range;
  if (start === undefined || end === undefined) {
    throw new Panic(`${doing} needs a range with both ends, not ${textOf(range)}.`);
  }
  return { start, end, step: range.step };
}

/**
 * How many ints `range` reaches: `start`, `start + step`, … before `end` in the step's direction.
 */
export function countOf({ start, end, step }: BoundedRange): bigint {
  const distance = step > 0n ? end - start : start - end;
  const stride = step > 0n ? step : -step;
  return distance > 0n ? (distance + stride - 1n) / stride : 0n;
}

/**
 * Whether `range` reaches `value`: between its ends that way, and a whole number of steps from its
 * start. A step longer than 1 with no start has nothing to count from, so it panics.
 */
export function reaches(range: RangeValue, value: bigint): boolean {
  const { start, end, step } = range;
  if (start === undefined && step !== 1n && step !== -1n) {
    throw new Panic(`The range ${textOf(range)} has no start for its step to count from.`);
  }
  const afterStart = start === undefined || (step > 0n ? value >= start : value <= start);
  const beforeEnd = end === undefined || (step > 0n ? value < end : value > end);
  const onStep = start === undefined || (value - start) % step === 0n;
  return afterStart && beforeEnd && onStep;
}

/** `range` as written: `a..b`, an end left out when open, and `by` a step other than 1. */
export function textOf({ start, end, step }: RangeValue): string {
  const ends = `${start ?? ''}..${end ?? ''}`;
  return step === 1n ? ends : `${ends} by ${step}`;
}
