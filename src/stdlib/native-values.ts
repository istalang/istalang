/**
 * The values std natives receive and return, as the runtime holds them: an `int` is a bigint, a
 * `float` a number, a `string` a string, a struct its fields in declaration order, an array its
 * elements, and an optional the `Some` or `None` variant of its declared type, told apart by
 * whether it has a field.
 *
 * An argument of another shape is a bug in lowering or loading, never in the program, so reading
 * one throws a TypeError rather than panicking.
 */

import type { MapValue } from '../definition/equality.ts';
import { childValues, isComposite, type Value } from '../definition/values.ts';
import { optionalVariants } from '../language/well-known.ts';
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

/** An argument of any type, as a generic native takes it; loading made sure it was passed. */
export function given(value: Value | undefined): Value {
  if (value === undefined) {
    throw new TypeError('An argument is missing.');
  }
  return value;
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

export function arrayOf(elements: readonly Value[]): Value {
  return { kind: 'array', elements: [...elements] };
}

/** A map argument. */
export function mapOfArgument(value: Value | undefined): MapValue {
  if (value === undefined || !isComposite(value) || value.kind !== 'map') {
    throw new TypeError('Expected a map.');
  }
  return value;
}

/** The value inside an optional argument, or undefined for `none`. */
export function optionalValue(value: Value | undefined): Value | undefined {
  if (value === undefined || !isComposite(value) || value.kind !== 'variant') {
    throw new TypeError('Expected an optional.');
  }
  return value.fields[0];
}

/** An optional of the extern's declared result type: `Some` of `value`, or `None` without one. */
export function resultOptional(context: NativeContext, value: Value | undefined): Value {
  const { entry, types } = context;
  const type = entry.kind === 'extern' && entry.result.kind === 'named' ? entry.result.type : -1;
  const optional = types[type];
  if (optional?.kind !== 'enum') {
    throw new TypeError(`${entry.name} doesn't return an optional.`);
  }
  const name = value === undefined ? optionalVariants.none : optionalVariants.some;
  const variant = optional.variants.findIndex((each) => each.name === name);
  return { kind: 'variant', type, variant, fields: value === undefined ? [] : [value] };
}
