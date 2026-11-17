/**
 * Waiting (spec §5, §8; proposal 8, Rule 5): the one instruction a frame stops at.
 *
 * Futures, resolvers and waits are Istalang (the prelude): an `await` or a `select` registers
 * resolvers of a wait with the futures it awaits, then parks the execution, which a resolver's
 * resolution unparks with the winning case's position (ir-first design, decisions 3 and 6).
 *
 * - `park` suspends the running execution, a live or ista entry's, its frame kept as data:
 *   `(function, parkedAt, registers)`, the label of the `park` it stands at and every register the
 *   code hasn't emptied, so each backend maps the label to its own resume point. In ista code it commits
 *   the segment first, so a frame in a snapshot always stands at a `park` (§5).
 * - Unparked, `dst` gets the position the wait was decided for, an `Int`.
 * - A call stopped while parked (§7: its future disposed and it not resuming on `disposing()`), or
 *   reaching a `park` once stopping, goes on at `stop` instead: its landing, which lets go of what
 *   the frame still owns, then ends the execution with `stopped`.
 * - A waypoint names the stop for `reaches`, `waitingAt` and the operator's view (§10).
 */

import { z } from 'zod';
import { label, register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const park = defineInstruction('park', {
  dst: register,
  stop: label,
  waypoint: z.string().optional(),
});

/** Ends a stopped execution, at the end of its stop landing. */
const stopped = defineInstruction('stopped', {});

export const suspensionInstructions = [park, stopped] as const;
