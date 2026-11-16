/**
 * A Definition: the whole compiled program, the contract between lowering and the runtime.
 *
 * It is a flat set of tables (modules, types, functions, constants) that refer to each other by
 * index. A deploy writes it once; the InstanceStore keeps it by content hash, and every instance
 * refers to that hash for its whole life (docs/arch/architecture.md, InstanceStore).
 *
 * Validation covers more than shapes: every index must land inside its table, and every
 * construction must match its type (validation/references.ts). The interpreter can then trust what
 * it reads, and a hand-edited or corrupted Definition is refused at load, never midway through an
 * instance.
 */

import type { z } from 'zod';
import { defineFormat } from './formats/format.ts';
import { tables } from './tables/index.ts';
import { checkReferences } from './validation/references.ts';

const definition = tables.superRefine(checkReferences);

export type Definition = z.output<typeof definition>;

/** The format's version: 2 lists each entry's counted registers, 3 writes behind a handle by `behind`. */
const version = 3;

export const definitionFormat = defineFormat('istalang-definition', version, definition);
