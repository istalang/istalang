/**
 * Places, cells and references (spec §3.7, §3.14, §3.18), and the per-call and per-instance
 * variables the runtime keeps (§3.4).
 *
 * - **A place says how it is reached.** Its root is a value in a register, the value in the cell a
 *   register holds (a variable passed by `&` or captured, a transient, the struct behind a shared
 *   struct's handle), or the place a reference register refers to. Its path steps into a tuple's
 *   element, a struct's field or a known variant's field, each a step of its own kind.
 * - **An indexed element is no step:** lowering reads it with its container's `index` and writes it
 *   back with `setIndex` (docs/arch/definition.md, "Places"), so following a path never runs code.
 * - **Writes are in place when unique.** `store` changes each value along its path where nothing
 *   else holds it, and copies it from there down where something does (ir-first design, decision
 *   5); derived data cached for a value changed in place is forgotten with it.
 * - **References** are values of a `&` parameter's register, referring into a cell or through
 *   another reference; a plain register's value is never referred to.
 */

import { z } from 'zod';
import { fieldIndex, label, register, variantIndex } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';

const root = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('register'), register }),
  z.strictObject({ kind: z.literal('cell'), register }),
  z.strictObject({ kind: z.literal('reference'), register }),
]);

const step = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tuple'), index: fieldIndex }),
  z.strictObject({ kind: z.literal('field'), field: fieldIndex }),
  z.strictObject({ kind: z.literal('variant'), variant: variantIndex, field: fieldIndex }),
]);

export type PlaceStep = z.output<typeof step>;

export const place = z.strictObject({ root, path: z.array(step) });

export type Place = z.output<typeof place>;

/** A new cell holding `value`, moved in; `dst`'s type is the cell's or the shared struct's. */
const newCell = defineInstruction('newCell', { dst: register, value: register });

/** `dst` another holder of the value at `place`. */
const load = defineInstruction('load', { dst: register, place });

/** Moves `value` into `place`, letting go of what the place held. */
const store = defineInstruction('store', { place, value: register });

/** `dst`, a reference register, refers to `place`, rooted at a cell or a reference. */
const reference = defineInstruction('reference', { dst: register, place });

/**
 * `dst`, a cell register of a transient (§3.4), borrows the cell of the nearest call this one is
 * nested in that runs the same function and has made one, and jumps to `target`; where none has,
 * on to the initializer, which makes it with `newCell` into `dst`, shared from then on with the
 * calls nested in this one until it returns.
 */
const transient = defineInstruction('transient', { dst: register, target: label });

/**
 * `dst` another holder of the instance's value of the context constant `name`, its qualified name
 * (§3.4), and a jump to `target`, once the instance has made one; while it hasn't, on to make it.
 */
const contextConstant = defineInstruction('contextConstant', {
  dst: register,
  name: z.string(),
  target: label,
});

/** Makes a copy of `value` the instance's value of the context constant `name`, kept from now on. */
const makeContextConstant = defineInstruction('makeContextConstant', {
  name: z.string(),
  value: register,
});

export const placeInstructions = [
  newCell,
  load,
  store,
  reference,
  transient,
  contextConstant,
  makeContextConstant,
] as const;
