/**
 * What every std module's natives share (docs/arch/definition.md, "Externs"):
 * - the key an extern declaration binds by, built through `externKey` alone so a natives table
 *   and lowering can't disagree, with types spelled as the declaration writes them
 * - reading arguments as the values the runtime holds: an `int` is a bigint, a `float` a number,
 *   a `string` a string, a struct its fields in declaration order
 *
 * An argument of another shape is a bug in lowering or loading, never in the program, so reading
 * one throws a TypeError rather than panicking.
 */

import { externKey, type KeyType } from '../definition/extern-key.ts';
import { childValues, isComposite, type Value } from '../definition/values.ts';
import type { NativeContext } from '../runtime/natives.ts';

/** A primitive parameter type as a key spells it. */
export function primitiveKeyType(name: string): KeyType {
  return { kind: 'primitive', name };
}

/** A named parameter type as a key spells it: module-qualified, such as `time.Time`. */
export function namedKeyType(name: string): KeyType {
  return { kind: 'named', name, arguments: [] };
}

/** The key of extern `name` declared in std module `module`, taking `parameters` by value. */
export function nativeKey(module: string, name: string, ...parameters: readonly KeyType[]): string {
  return externKey({
    module,
    name,
    parameters: parameters.map((type) => ({ type, reference: false })),
  });
}

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
