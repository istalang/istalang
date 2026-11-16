/**
 * A Definition: the whole compiled program, the contract between lowering and every backend
 * (docs/arch/definition.md).
 *
 * It is a flat set of tables (modules, types, functions, constants) that refer to each other by
 * index. A deploy writes it once; the store keeps it by content hash, and every instance refers to
 * that hash for its whole life.
 *
 * Validation covers more than shapes (./validation/): every index lands in its table, every
 * instruction's registers have the types it needs, and every owned register is let go of exactly
 * once on every path (the ownership verifier). A backend then trusts what it reads, and a
 * hand-edited or corrupted Definition is refused at load, never midway through an instance.
 */

import type { z } from 'zod';
import { defineFormat } from './formats/format.ts';
import { tables } from './tables/index.ts';
import { validate } from './validation/index.ts';

const definition = tables.superRefine(validate);

export type Definition = z.output<typeof definition>;

const version = 4;

export const definitionFormat = defineFormat('istalang-definition', version, definition);
