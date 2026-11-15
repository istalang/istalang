/**
 * What compiled code's instructions call beyond its run (codegen/instructions/): its factory takes
 * these by name (codegen/emit.ts), so the emitter and this table name each helper alike.
 */

import { mapOf, valuesEqual } from '../../definition/values/equality.ts';
import { withPartAt } from '../../definition/values/parts.ts';
import {
  childValues,
  elementsOf,
  isComposite,
  mapValueOf,
  type Value,
} from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { Future } from '../waits/future.ts';
import { Cell } from './cell.ts';
import { Place } from './place.ts';

/** A new cell holding `value`. */
function cellOf(value: Value): Cell {
  return new Cell(value);
}

/** `cell` holding `value`, made by its first write. */
function wcell(cell: Cell | undefined, value: Value): Cell {
  if (cell === undefined) {
    return new Cell(value);
  }
  cell.v = value;
  return cell;
}

/** The place at `path` in `cell`'s value. */
function placeIn(cell: Cell, path: readonly number[]): Place {
  return new Place(cell, path);
}

/** A new future: an async call's, which its body settles. */
function newFuture(): Future {
  return new Future();
}

/** Field `index` of `value`: a tuple element, a struct field, or a field of an enum's variant. */
function field(value: Value, index: number): Value {
  if (!isComposite(value)) {
    return unreachable(`A ${typeof value} has no field ${index}.`);
  }
  return childValues(value)[index] as Value;
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
  cellOf,
  wcell,
  placeIn,
  newFuture,
  withPart: withPartAt,
  field,
  eq,
  mapOf,
  mapValueOf,
  keep,
  noVariant,
  noInstruction,
};
