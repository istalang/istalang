/**
 * Instructions that build and read values.
 *
 * - **Ownership is in the instruction** (docs/arch/definition.md, "Holders"). `move` hands a value
 *   on, emptying its source; `copy` makes another holder of it. Construction moves its parts in, so
 *   a part kept elsewhere is copied first. A read of a part borrows it into a borrowed register,
 *   holding nothing, valid while the value it was read from stays unchanged in its register.
 * - **One instruction per meaning.** A tuple's element, a struct's field and a variant's field are
 *   read apart; a variant's field is read where its variant is known (after a `switch`).
 * - Only what can't be an ordinary call is an instruction: construction of the built-in shapes, the
 *   operators the spec makes non-overloadable (§3.9: structural `==`, `not`), the primitive
 *   operations (./primitive-ops.ts) and turning a comparison's result into a `Bool`. Everything
 *   else is a call of a resolved function.
 */

import { z } from 'zod';
import { constantId, fieldIndex, functionId, register, typeId, variantIndex } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';
import { primitiveOp } from './primitive-ops.ts';

/** A constant of the Definition's table, owned by `dst`. */
const constant = defineInstruction('constant', { dst: register, constant: constantId });

/** Hands `src`'s value on to `dst`, emptying `src`. */
const move = defineInstruction('move', { dst: register, src: register });

/** Makes `dst` another holder of `src`'s value. */
const copy = defineInstruction('copy', { dst: register, src: register });

const tuple = defineInstruction('tuple', { dst: register, elements: z.array(register) });

/** A struct of entry `type`, its fields in its entry's order. */
const struct = defineInstruction('struct', {
  dst: register,
  type: typeId,
  fields: z.array(register),
});

const variant = defineInstruction('variant', {
  dst: register,
  type: typeId,
  variant: variantIndex,
  fields: z.array(register),
});

/**
 * An array of `elements` in order; a spread's every item, each copied, its register kept (§3.3).
 */
const array = defineInstruction('array', {
  dst: register,
  elements: z.array(z.strictObject({ value: register, spread: z.boolean() })),
});

const mapEntry = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entry'), key: register, value: register }),
  z.strictObject({ kind: z.literal('spread'), value: register }),
]);

/** A `Map` of its entries in order, a later key replacing an earlier; a spread as `array`'s. */
const map = defineInstruction('map', { dst: register, entries: z.array(mapEntry) });

/**
 * `collection`, an array being built, with `item` appended, both moved in: changed in place where
 * nothing else holds it, so a comprehension builds its array in linear time (§4).
 */
const append = defineInstruction('append', {
  dst: register,
  collection: register,
  item: register,
});

/** `collection`, a `Map` being built, with `key` set to `value`, as `append` appends: a key there is replaced. */
const appendEntry = defineInstruction('appendEntry', {
  dst: register,
  collection: register,
  key: register,
  value: register,
});

/** A closure of `function` carrying `captures` (§3.14). */
const closure = defineInstruction('closure', {
  dst: register,
  function: functionId,
  captures: z.array(register),
});

/** The closure the running code entry runs as, borrowed: a local `fn`'s own name (§3.14). */
const currentClosure = defineInstruction('currentClosure', { dst: register });

const tupleItem = defineInstruction('tupleItem', {
  dst: register,
  src: register,
  index: fieldIndex,
});

const structField = defineInstruction('structField', {
  dst: register,
  src: register,
  field: fieldIndex,
});

/** A field of `src`, which holds variant `variant` of its enum. */
const variantField = defineInstruction('variantField', {
  dst: register,
  src: register,
  variant: variantIndex,
  field: fieldIndex,
});

/** The built-in structural `==` (§3.9). */
const equal = defineInstruction('equal', { dst: register, left: register, right: register });

const not = defineInstruction('not', { dst: register, src: register });

/** Whether a comparison's `Int` result (negative, zero, positive) stands in `relation`. */
const order = defineInstruction('order', {
  dst: register,
  comparison: register,
  relation: z.enum(['less', 'lessOrEqual', 'greater', 'greaterOrEqual']),
});

/** A primitive operation of a backend's own (./primitive-ops.ts). */
const primitive = defineInstruction('primitive', {
  dst: register,
  op: primitiveOp,
  operands: z.array(register),
});

export const dataInstructions = [
  constant,
  move,
  copy,
  tuple,
  struct,
  variant,
  array,
  map,
  append,
  appendEntry,
  closure,
  currentClosure,
  tupleItem,
  structField,
  variantField,
  equal,
  not,
  order,
  primitive,
] as const;
