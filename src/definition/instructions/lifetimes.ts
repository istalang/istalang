/**
 * Letting go (spec §7.1, §16; docs/arch/definition.md, "Holders").
 *
 * Lowering decides every point a register lets go of what it owns: a block's end on every exit
 * path, a statement's end for its temporaries, `drop x`, overwriting a variable, a `return` for
 * everything still owned, a `park`'s stop landing, a `select`'s losing cases where the winner
 * resumes. Holding is the other half: `copy` makes a holder, a construction or `store` moves one in
 * (./data.ts, ./places.ts), and a borrowed register holds nothing.
 *
 * Letting go empties each register; letting go of an empty one does nothing. What lost its last
 * holder is disposed then, values losing it together newest first.
 *
 * `hold let`, `hold const` and `hold _` keep their values until a scope around them ends (§7.1),
 * even from a loop body: each is copied into an array of its own type, a variable of that scope
 * let go of where the scope ends.
 */

import { z } from 'zod';
import { register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const letGo = defineInstruction('letGo', { registers: z.array(register).min(1) });

export const lifetimeInstructions = [letGo] as const;
