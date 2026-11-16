/**
 * Control flow inside one function.
 *
 * `if`, `while`, `for`, `match`, `and`/`or`, `?.`, `??` and `?` lower to jumps and branches; a
 * branching expression writes its value to a register the lowering chose. Jumping never lets go of
 * anything: leaving a block early is a `letGo` before the jump (./lifetimes.ts).
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

/**
 * Jumps by the variant of an enum value: `targets[i]` handles variant i, `otherwise` every variant
 * past the targets, so a test for one variant needn't list the rest.
 */
const switchVariant = defineInstruction('switch', {
  value: register,
  targets: z.array(label),
  otherwise: label.optional(),
});

/**
 * Ends the call, giving `value`, moved out. Every other register owning something has been let go
 * by then (./lifetimes.ts): `return` itself lets go of nothing.
 */
const returnValue = defineInstruction('return', { value: register });

export const controlInstructions = [jump, branch, switchVariant, returnValue] as const;
