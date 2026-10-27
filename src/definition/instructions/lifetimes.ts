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
 * `hold let`, `hold const` and `hold _` keep their holdings until a scope around their block ends:
 * the function, or the loop or block `hold(name)` names (spec §3.4), even from a loop body that
 * runs many times. A register can't hold one value per iteration, so the block's end moves them
 * into a list (`keep`, then `release`): the value of a hidden variable of that scope, released
 * when the scope ends, as any of its variables is. One mechanism serves every scope, the
 * function's included, so a frame holds nothing beside its registers.
 */

import { z } from 'zod';
import { register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const registers = z.array(register).min(1);

const release = defineInstruction('release', { registers });

/**
 * Adds the registers' values to the array in `into`, starting one when `into` is empty: holders
 * until the scope `into` belongs to releases it. Only `keep` writes `into`, and nothing reads it.
 */
const keep = defineInstruction('keep', { registers, into: register });

/**
 * `defer f`: a disposable guard that calls `f` when it is disposed. Held in a register like any
 * other value, so it runs when its block releases it, including on disposal at an await (spec §7).
 */
const defer = defineInstruction('defer', { dst: register, callback: register });

export const lifetimeInstructions = [release, keep, defer] as const;
