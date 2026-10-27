/**
 * Calls, and the contexts calls create.
 *
 * Every call targets a function-table entry, directly or through a function value. Externs are
 * entries too (functions.ts), so there is one call path, where a mock replaces a function whatever
 * it is, and one place extern results are seen (spec §10).
 *
 * Calling an async function starts a new execution right away and gives `dst` its future (spec
 * §3.3); the instruction is the same, since the callee's entry says whether it is async.
 */

import { z } from 'zod';
import { functionId, register, typeId } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';
import { argument } from './places.ts';

const callee = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('function'), function: functionId }),
  z.strictObject({ kind: z.literal('value'), register }),
]);

export type Callee = z.output<typeof callee>;

/** Without `dst`, the result is discarded; the checker only allows that for a non-must-use result. */
const call = defineInstruction('call', {
  dst: register.optional(),
  callee,
  arguments: z.array(argument),
});

/**
 * `spawn f(args)`: a new instance on this Definition, running a named function or a closure of a
 * sendable function type, whose captures go along; the arguments are sendable copies (spec §9).
 * `dst` gets its `Instance<T>`, of extern type entry `type`, whose payload is the instance's name.
 */
const spawn = defineInstruction('spawn', {
  dst: register,
  type: typeId,
  callee,
  arguments: z.array(register),
});

/**
 * A handle to the async call this frame belongs to, taken once at a function's entry so that
 * `worker.disposing()` reaches the enclosing call from any nested function (spec §7).
 */
const currentCall = defineInstruction('currentCall', { dst: register });

export const callInstructions = [call, spawn, currentCall] as const;
