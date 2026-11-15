/**
 * What compiled code's instructions call beyond its run (codegen/instructions/): its factory takes
 * these by name (codegen/emit.ts), so the emitter and this table name each helper alike.
 */

import { mapOf, valuesEqual } from '../../definition/values/equality.ts';
import { fieldAt, withPartAt } from '../../definition/values/parts.ts';
import { elementsOf, isComposite, mapValueOf, type Value } from '../../definition/values/values.ts';
import type { Cell } from './cell.ts';
import { Place } from './place.ts';

/** The place at `path` in `cell`'s value. */
function placeIn(cell: Cell, path: readonly number[]): Place {
  return new Place(cell, path);
}

/** Built-in structural `==`, identical values equal at once. */
function eq(left: Value, right: Value): boolean {
  return left === right || valuesEqual(left, right);
}

/** `list`, a hold's list (`keep`), with what `held` holds added. */
function keep(list: Value | undefined, held: readonly (Value | undefined)[]): Value {
  const kept = held.filter((each) => each !== undefined);
  return { kind: 'array', elements: list === undefined ? kept : [...elementsOf(list), ...kept] };
}

function noVariant(value: Value): Error {
  return new Error(
    `'switch' found no target for a ${isComposite(value) ? value.kind : typeof value}.`,
  );
}

function noInstruction(pc: number): Error {
  return new Error(`No instruction ${pc}.`);
}

export const helpers = {
  placeIn,
  withPart: withPartAt,
  field: fieldAt,
  eq,
  mapOf,
  mapValueOf,
  keep,
  noVariant,
  noInstruction,
};
