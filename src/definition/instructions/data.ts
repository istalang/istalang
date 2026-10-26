/**
 * Instructions that build, read and write values.
 *
 * Only what can't be an ordinary call is an instruction:
 * - construction of the built-in shapes (tuple, struct, variant, array, map, closure)
 * - field access and writes through places
 * - the operators the spec makes non-overloadable (§3.9): structural `==`, `not`, and `*` and
 *   `*x = v`, which read and write the cell behind a shared struct's handle, which `new` makes
 * - turning `compare`'s result into a boolean, since all four comparisons go through one
 *   `compare` (spec §3.9)
 * Arithmetic, indexing, conversions and iteration are calls to resolved functions, which
 * for primitives are prelude externs.
 *
 * Writing a register that holds a cell (a variable passed by `&` or captured by a closure) or a
 * reference parameter goes through it; the function's metadata says which registers those are
 * (functions.ts).
 */

import { z } from 'zod';
import { constantId, fieldIndex, functionId, register, typeId, variantIndex } from '../operands.ts';
import { defineInstruction } from './define-instruction.ts';
import { place } from './places.ts';

/** dst = constants[constant]. */
const constant = defineInstruction('constant', { dst: register, constant: constantId });

/** dst = src, adding a holder to every disposable inside the value (spec §7). */
const move = defineInstruction('move', { dst: register, src: register });

const tuple = defineInstruction('tuple', { dst: register, elements: z.array(register) });

/** Fields in the type's declaration order; the lowering resolves shorthand, positional and spread forms. */
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

/** Reads a tuple element, a struct field, or a field of an enum value's current variant. */
const field = defineInstruction('field', { dst: register, src: register, index: fieldIndex });

/** Writes a place with a non-empty path: `p.x = v`, `xs[i] = v`, `a[k].b = v`. */
const store = defineInstruction('store', {
  place: place.refine((target) => target.path.length > 0, 'A store path is never empty; use move.'),
  value: register,
});

const item = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('item'), value: register }),
  z.strictObject({ kind: z.literal('spread'), value: register }),
]);

/**
 * dst = a handle to a new cell of the shared struct entry `type`, holding `value`: `new X{…}`
 * (spec §3.18).
 */
const newCell = defineInstruction('newCell', { dst: register, type: typeId, value: register });

/** dst = the value in the cell the handle in `cell` names: `*x` (spec §3.9). */
const readCell = defineInstruction('readCell', { dst: register, cell: register });

/** Writes `value` to the cell the handle in `cell` names, for every copy of it: `*x = v`. */
const writeCell = defineInstruction('writeCell', { cell: register, value: register });

/** `[a, ...xs, b]`, a spread copying another array's elements. */
const array = defineInstruction('array', { dst: register, elements: z.array(item) });

const entry = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('entry'), key: register, value: register }),
  z.strictObject({ kind: z.literal('spread'), value: register }),
]);

/**
 * `[k: v, ...m]` for a Map, a spread copying another map's entries; literals of other indexable
 * types lower to `default` and `setIndex` calls.
 */
const map = defineInstruction('map', { dst: register, entries: z.array(entry) });

/** A function value. A top-level function used as a value is a closure with no captures. */
const closure = defineInstruction('closure', {
  dst: register,
  function: functionId,
  captures: z.array(register),
});

/** The closure the current frame runs, so a named lambda or local `fn` can refer to itself. */
const currentClosure = defineInstruction('currentClosure', { dst: register });

/** Built-in structural equality: values by structure, handles by identity. */
const equal = defineInstruction('equal', { dst: register, left: register, right: register });

const not = defineInstruction('not', { dst: register, src: register });

/** Turns the int that `compare` returned into the boolean an operator asked for. */
const order = defineInstruction('order', {
  dst: register,
  comparison: register,
  relation: z.enum(['less', 'lessOrEqual', 'greater', 'greaterOrEqual']),
});

export const dataInstructions = [
  constant,
  move,
  tuple,
  struct,
  variant,
  field,
  store,
  newCell,
  readCell,
  writeCell,
  array,
  map,
  closure,
  currentClosure,
  equal,
  not,
  order,
] as const;
