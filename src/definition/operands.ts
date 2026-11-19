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
 * (docs/arch/definition.md, "Frames"). Every index, offset and count has one rule; a reference
 * into one of the Definition's tables has a schema of its own, so a walk of a Definition's schema
 * finds each kind of reference (references.ts), and the other names exist for readability.
 */

import { z } from 'zod';

/** The one rule of every index; each table's references get a schema of their own from it. */
const indexSchema = () => z.int().nonnegative();

const index = indexSchema();

export const register = index;
export const label = index;
export const moduleId = indexSchema();
export const functionId = indexSchema();
export const typeId = indexSchema();
export const constantId = indexSchema();
export const objectId = index;
/** A binding of a function slot in a test (§18), numbered from its instance's object serial. */
export const bindingId = index;
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
