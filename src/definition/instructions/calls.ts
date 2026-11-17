/**
 * Calls, and what a code entry knows of the call running it.
 *
 * - **One call path.** Every call targets a function-table entry, directly or through a function
 *   value, externs included (../tables/functions.ts): mocks, traces and extern results are seen in
 *   one place.
 * - **Arguments are borrowed.** The callee holds none of them unless it copies one; a `&` argument
 *   is a reference register (./places.ts). A parameter the call leaves out is `omitted`, which the
 *   callee's prologue computes.
 * - **An async callee starts an execution** of its own right away, and `dst` owns the future it
 *   gives (§3.3); the instruction is the same, the callee's entry saying which it is.
 * - **Mocks** (§10) are asked only in a Definition built to run tests: `mocked` stands where a
 *   mockable function's body begins, past its prologue, and hands the call over to the newest mock
 *   held for it, if any (docs/arch/definition.md, "Frames").
 */

import { z } from 'zod';
import { functionId, label, register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const callee = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('function'), function: functionId }),
  z.strictObject({ kind: z.literal('value'), register }),
]);

export type Callee = z.output<typeof callee>;

const argument = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), register }),
  z.strictObject({ kind: z.literal('omitted') }),
]);

export type Argument = z.output<typeof argument>;

const call = defineInstruction('call', {
  dst: register,
  callee,
  arguments: z.array(argument),
});

/** The running execution's call, borrowed: the handle `disposing()` watches (§7). */
const currentCall = defineInstruction('currentCall', { dst: register });

/** Jumps to `target` when the call gave `parameter`; else on to compute its default. */
const given = defineInstruction('given', { parameter: register, target: label });

/**
 * Where a mock held for the running function exists (§10), the newest's result for `arguments`,
 * every parameter's value once the prologue computed its default, in `dst`, and a jump to
 * `landing`, which lets go of what the frame owns and returns it; else on to the body.
 */
const mocked = defineInstruction('mocked', {
  dst: register,
  arguments: z.array(register),
  landing: label,
});

export const callInstructions = [call, currentCall, given, mocked] as const;
