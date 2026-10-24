/**
 * The only instructions an execution can stop at (spec §5, §8).
 *
 * `await` and a blocking `select` commit the segment before waiting, so a frame's persisted
 * position is always one of these. A non-blocking `select` (one with `otherwise`) chooses at once
 * and never commits. An optional waypoint names the stop for `reaches`, `waitingAt` and the
 * operator's view (spec §10).
 */

import { z } from 'zod';
import { label, register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const waypoint = z.string().optional();

const awaitFuture = defineInstruction('await', { dst: register, future: register, waypoint });

const selectCase = z.strictObject({
  future: register,
  /**
   * The registers this case's expression created. A losing case's holdings are released when
   * the winner is chosen; the winner's stay with the enclosing block (spec §8).
   */
  holds: z.array(register),
  /** Receives the resolved value, for `case f as name`. */
  bind: register.optional(),
  target: label,
});

/** Picks the first resolved case in order; with `otherwise`, it never waits. */
const select = defineInstruction('select', {
  cases: z.array(selectCase).min(1),
  otherwise: label.optional(),
  waypoint,
});

export const suspensionInstructions = [awaitFuture, select] as const;
