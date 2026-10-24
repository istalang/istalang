/**
 * What persisted formats point at, and the spans they carry.
 *
 * Everything is an index:
 * - a register into its frame
 * - a label into its function's instructions
 * - a module, function, type or constant into the Definition's tables
 * - a field or variant into its type's lists
 * - an object into the snapshot's heap
 * Indexes keep the JSON small, and they make a frame's position in the code a single number
 * (docs/arch/definition.md, "Frames"). Every index, offset and count is the same schema; the
 * names exist for readability at the use site and are the one place to change if any of them
 * ever needs its own rule.
 */

import { z } from 'zod';

const index = z.int().nonnegative();

export const register = index;
export const label = index;
export const moduleId = index;
export const functionId = index;
export const typeId = index;
export const constantId = index;
export const objectId = index;
export const fieldIndex = index;
export const variantIndex = index;

/** A UTF-16 offset into a module's source. */
export const offset = index;

/** A size: registers in a frame, captures in a closure. */
export const count = index;

/** [start, end) offsets into the function's module: the shape of text/Span. */
export const span = z.strictObject({ start: offset, end: offset });

export type Register = z.output<typeof register>;
export type Label = z.output<typeof label>;
export type FunctionId = z.output<typeof functionId>;
export type TypeId = z.output<typeof typeId>;
export type ConstantId = z.output<typeof constantId>;
