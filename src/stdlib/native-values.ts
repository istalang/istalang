/**
 * The values std natives receive and return, as the runtime holds them: an `int` is a bigint, a
 * `float` a number, a `string` a string, a struct its fields in declaration order.
 *
 * An argument of another shape is a bug in lowering or loading, never in the program, so reading
 * one throws a TypeError rather than panicking.
 */

import { childValues, isComposite, type Value } from '../definition/values.ts';
import type { NativeContext } from '../runtime/natives.ts';

interface ArgumentTypes {
  readonly bigint: bigint;
  readonly number: number;
  readonly string: string;
}

/** An argument read as the JavaScript type `name`. */
function argumentOf<Name extends keyof ArgumentTypes>(
  name: Name,
): (value: Value | undefined) => ArgumentTypes[Name] {
  return (value) => {
    if (typeof value !== name) {
      throw new TypeError(`Expected a ${name}, got ${typeof value}.`);
    }
    return value as ArgumentTypes[Name];
  };
}

export const int = argumentOf('bigint');
export const float = argumentOf('number');
export const text = argumentOf('string');

/** Field `index` of a struct argument. */
export function fieldOf(value: Value | undefined, index: number): Value {
  const field = value !== undefined && isComposite(value) ? childValues(value)[index] : undefined;
  if (field === undefined) {
    throw new TypeError(`Expected a struct with a field ${index}.`);
  }
  return field;
}

/** A struct of the extern's declared result type, with `fields` in declaration order. */
export function resultStruct(context: NativeContext, fields: Value[]): Value {
  const { entry } = context;
  if (entry.kind !== 'extern' || entry.result.kind !== 'named') {
    throw new TypeError(`${entry.name} doesn't return a struct.`);
  }
  return { kind: 'struct', type: entry.result.type, fields };
}
