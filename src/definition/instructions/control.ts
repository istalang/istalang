/**
 * Control flow inside one function.
 *
 * `if`, `while`, `for`, `match`, `and`/`or`, `?.`, `??` and `?` all lower to these jumps; a
 * branching expression writes its value to a result register the lowering chose (spec §4).
 * Leaving a block early (`break`, `continue`) is a `release` followed by a `jump`, so the
 * jump itself never disposes anything.
 */

import { z } from 'zod';
import { label, register } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const jump = defineInstruction('jump', { target: label });

const branch = defineInstruction('branch', {
  condition: register,
  whenTrue: label,
  whenFalse: label,
});

/** Jumps by the variant index of an enum value: `targets[i]` handles variant i. */
const switchVariant = defineInstruction('switch', { value: register, targets: z.array(label) });

/**
 * Ends the function. Every register still holding something is released, in reverse creation
 * order of what each one disposes (spec §7). An async function resolves its call's future.
 */
const returnValue = defineInstruction('return', { value: register });

export const controlInstructions = [jump, branch, switchVariant, returnValue] as const;
