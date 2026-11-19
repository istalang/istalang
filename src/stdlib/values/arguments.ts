/**
 * The values std natives receive, as the runtime holds them: an `Int` is a bigint, a `Float` a
 * number, a `String` a string, a struct its fields in declaration order, an array its elements, an
 * optional the variant of its declared union holding its member, or its `None` variant, told apart
 * by name (`optionalValueOf`), and a value of an extern type the runtime implements its type and a
 * payload. What a native returns is built as its declared result says (results.ts).
 *
 * An argument of another shape is a bug in lowering or loading, never in the program, so reading
 * one throws a TypeError rather than panicking.
 */

import { optionalValueOf } from '../../definition/values/declared-values.ts';
import { isComposite, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { NativeContext } from '../../runtime/natives.ts';

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
      unreachable(`Expected a ${name}, got ${typeof value}.`);
    }
    return value as ArgumentTypes[Name];
  };
}

/** An argument of any type, as a generic native takes it; loading made sure it was passed. */
export function given(value: Value | undefined): Value {
  if (value === undefined) {
    unreachable('An argument is missing.');
  }
  return value;
}

export const int = argumentOf('bigint');
export const float = argumentOf('number');
export const text = argumentOf('string');

/** The payload of an argument of an extern type the runtime implements (§17.2). */
export function externPayloadOf(value: Value | undefined): unknown {
  if (value === undefined || !isComposite(value) || value.kind !== 'extern') {
    unreachable('Expected a value of an extern type.');
  }
  return value.payload;
}

/** The text an argument of an extern type whose values the runtime keeps as text holds. */
export function textPayloadOf(value: Value | undefined): string {
  const payload = externPayloadOf(value);
  return typeof payload === 'string' ? payload : unreachable('Expected an extern value of text.');
}

export function arrayOf(elements: readonly Value[]): Value {
  return { kind: 'array', elements: [...elements] };
}

/** The declared name of the variant an enum argument holds. */
function variantName(context: NativeContext, value: Value | undefined): string {
  if (value === undefined || !isComposite(value) || value.kind !== 'variant') {
    unreachable('Expected an enum.');
  }
  const declared = context.types[value.type];
  const variant = declared?.kind === 'enum' ? declared.variants[value.variant] : undefined;
  return variant?.name ?? unreachable(`Type ${value.type} has no variant ${value.variant}.`);
}

/** The `Int` inside an optional argument, such as a slice's `end`, or undefined for `none`. */
export function optionalInt(
  context: Pick<NativeContext, 'types'>,
  value: Value | undefined,
): bigint | undefined {
  const inside = optionalValueOf(context.types, value);
  return inside === undefined ? undefined : int(inside);
}

/**
 * The entry of `table` for the variant an enum argument holds, by its declared name; a variant the
 * table lacks fails loudly, so a table and its enum can't drift apart unnoticed.
 */
export function variantEntry<Entry>(
  context: NativeContext,
  value: Value | undefined,
  table: Readonly<Record<string, Entry>>,
): Entry {
  const name = variantName(context, value);
  const entry = Object.hasOwn(table, name) ? table[name] : undefined;
  return entry === undefined
    ? unreachable(`${context.name} has no entry for variant ${name}.`)
    : entry;
}
