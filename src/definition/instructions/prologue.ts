/**
 * A code entry's prologue (spec §3.3): what it runs at the start of every call, before its body,
 * computing in parameter order each parameter the call left out from its default.
 *
 * - A parameter a call leaves out arrives absent: its register is empty, never a sentinel value, so
 *   no value a program can make is mistaken for one left out. `given` tests that register and skips
 *   the default's code when the call gave it; the default's code then writes the parameter, seeing
 *   the parameters before it, and never waits.
 * - `body` marks where the body begins, once in an entry with a parameter a call may leave out and
 *   never elsewhere. It is an instruction rather than an entry field because the runtime acts on
 *   reaching it: a call a mock replaces with arguments left out runs the target's prologue, then
 *   hands over to the mock there (§10), and an instruction gets that from its own handler, where an
 *   offset in the entry would need a check at every instruction. Traces read the frames still before
 *   it as being in their prologue (`bodyStart`).
 */

import { label, register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

/** Jumps to `target` when the call gave `parameter`; else goes on to compute its default. */
const given = defineInstruction('given', { parameter: register, target: label });

/** Where the entry's body begins, after its prologue. */
const body = defineInstruction('body', {});

export const prologueInstructions = [given, body] as const;
