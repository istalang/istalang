/**
 * The shape of one instruction family's emitters: a typed table over the family's kinds, each giving
 * the one line of JavaScript its instruction runs as (docs/work/js-codegen/design.md, "Control flow").
 * One line each, so a line of the generated module names one instruction for traces.
 */

import type { z } from 'zod';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { Handlers } from '../../foundation/structures/kind-table.ts';
import type { EntryScope } from '../entry-scope.ts';

/** Emitters for the instructions `Family`, a family's schemas, lists. */
export type Emitters<Family extends readonly z.ZodType[]> = Handlers<
  EntryScope,
  Extract<Instruction, z.output<Family[number]>>,
  [],
  string
>;
