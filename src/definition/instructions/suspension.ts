/**
 * Waiting (spec §5, §8; proposal 8, Rule 5): a wait, its resolvers, and the only instructions an
 * execution can stop at.
 *
 * - A wait is explicit: `wait` makes one in a register, `resolver` gives it the resolver of one case,
 *   which the lowering hands to that case's `onAwait`, and `await` or a `select` then waits on it,
 *   naming no future. A register rather than the execution's current wait, since an `onAwait` may
 *   itself run a non-blocking `select`, a wait of its own, while the wait it was called for is open.
 * - `await` and a blocking `select` commit the segment before waiting, so a frame's persisted
 *   position is always one of these. A non-blocking `select` (one with `otherwise`) chooses at once
 *   and never commits. An optional waypoint names the stop for `reaches`, `waitingAt` and the
 *   operator's view (spec §10).
 */

import { z } from 'zod';
import { count, label, register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const waypoint = z.string().optional();

/** A new wait of the running execution, pending, in `dst`. */
const wait = defineInstruction('wait', { dst: register });

/** A new resolver of the wait in `wait`, for its case `position` (an `await`'s is 0), in `dst`. */
const resolver = defineInstruction('resolver', { dst: register, wait: register, position: count });

/** Waits until the wait in `wait` is decided, then gives `dst` its value. */
const awaitWait = defineInstruction('await', { dst: register, wait: register, waypoint });

const selectCase = z.strictObject({
  /**
   * The registers this case's expression created. A losing case's holdings are released when
   * the winner is chosen; the winner's stay with the enclosing block (spec §8).
   */
  holds: z.array(register),
  /** Receives the resolved value, for `case f as name`. */
  bind: register.optional(),
  target: label,
});

/**
 * Goes on at the case the wait in `wait` was decided at; with `otherwise`, it never waits, going
 * there when the wait is undecided.
 */
const select = defineInstruction('select', {
  wait: register,
  cases: z.array(selectCase).min(1),
  otherwise: label.optional(),
  waypoint,
});

export const suspensionInstructions = [wait, resolver, awaitWait, select] as const;
