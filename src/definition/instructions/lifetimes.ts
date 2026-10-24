/**
 * Releasing what registers hold (spec §3.4, §7).
 *
 * The lowering decides every release point, so the runtime never infers scopes:
 * - a block's end, on every exit path (fall-through, `break`, `continue`)
 * - a statement's end, for its temporaries
 * - `drop x`
 * Releasing empties the registers; whatever lost its last holder is disposed, in reverse
 * creation order. `return` releases every register.
 *
 * `fn let`, `fn const` and `fn _` keep their holdings until the function ends, even from a loop
 * body that runs many times (spec §3.4). A register can't hold one value per iteration, so the
 * block's end moves them into the frame's kept list (`keep`, then `release`), which only `return`
 * empties.
 */

import { z } from 'zod';
import { register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const registers = z.array(register).min(1);

const release = defineInstruction('release', { registers });

/** Adds the registers' values to the frame's kept list, as holders until the function returns. */
const keep = defineInstruction('keep', { registers });

/**
 * `defer f`: a disposable guard that calls `f` when it is disposed. Held in a register like any
 * other value, so it runs when its block releases it, including on disposal at an await (spec §7).
 */
const defer = defineInstruction('defer', { dst: register, callback: register });

export const lifetimeInstructions = [release, keep, defer] as const;
