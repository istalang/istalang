/**
 * The values std natives receive and return, as the runtime holds them: an `int` is a bigint, a
 * `float` a number, a `string` a string, a struct its fields in declaration order, an array its
 * elements, an optional the `Some` or `None` variant of its declared type, told apart by whether
 * it has a field, and a value of an extern type the runtime implements its type and a payload.
 *
 * An argument of another shape is a bug in lowering or loading, never in the program, so reading
 * one throws a TypeError rather than panicking.
 */

import {
  type NamedFields,
  namedType,
  optionalOf,
  structOf,
  typeArgumentOf,
  variantOf,
  variantShape,
} from '../definition/declared-values.ts';
import type { TypeId } from '../definition/operands.ts';
import { childValues, isComposite, type Value } from '../definition/values.ts';
import { resultVariants } from '../language/well-known.ts';
import type { NativeContext } from '../runtime/natives.ts';
import { unreachable } from '../structures/unreachable.ts';

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

/** Field `index` of a struct argument. */
export function fieldOf(value: Value | undefined, index: number): Value {
  const field = value !== undefined && isComposite(value) ? childValues(value)[index] : undefined;
  if (field === undefined) {
    unreachable(`Expected a struct with a field ${index}.`);
  }
  return field;
}

/** The type entry the extern's declared result names: a struct or an enum. */
function declaredResult(context: NativeContext): TypeId {
  return context.resultType ?? unreachable(`${context.name} returns no named type.`);
}

/** A struct of the extern's declared result type, with `fields` by name. */
export function resultStruct(context: NativeContext, fields: NamedFields): Value {
  return structOf(context.types, declaredResult(context), fields);
}

/** The payload of an argument of an extern type the runtime implements (§3.6). */
function payloadOf(value: Value | undefined): unknown {
  if (value === undefined || !isComposite(value) || value.kind !== 'extern') {
    unreachable('Expected a value of an extern type.');
  }
  return value.payload;
}

/** The text an argument of an extern type whose values the runtime keeps as text holds. */
export function textPayloadOf(value: Value | undefined): string {
  const payload = payloadOf(value);
  return typeof payload === 'string' ? payload : unreachable('Expected an extern value of text.');
}

/** A value of extern type entry `type`, holding `payload`. */
function externOf(type: TypeId, payload: unknown): Value {
  return { kind: 'extern', type, payload };
}

/** A value of the extern type the extern declares as its result, holding `payload`. */
export function resultExtern(context: NativeContext, payload: unknown): Value {
  return externOf(declaredResult(context), payload);
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

/** The value inside an optional argument, or undefined for `none`. */
export function optionalValue(value: Value | undefined): Value | undefined {
  if (value === undefined || !isComposite(value) || value.kind !== 'variant') {
    unreachable('Expected an optional.');
  }
  return value.fields[0];
}

/** An optional of the extern's declared result type: `Some` of `value`, or `None` without one. */
export function resultOptional(context: NativeContext, value: Value | undefined): Value {
  return optionalOf(context.types, declaredResult(context), value);
}

/** `Ok` of `value`, of the extern's declared `Result` type (§3.12). */
export function resultOk(context: NativeContext, value: Value): Value {
  return resultVariant(context, resultVariants.ok, { value });
}

/** A struct of the type the extern's declared `Result` holds when `Ok`, with `fields` by name. */
export function okStruct(context: NativeContext, fields: NamedFields): Value {
  return structOf(context.types, okType(context), fields);
}

/** A value of the extern type the extern's declared `Result` holds when `Ok`, holding `payload`. */
export function okExtern(context: NativeContext, payload: unknown): Value {
  return externOf(okType(context), payload);
}

/** The type the extern's declared `Result` holds when `Ok`. */
function okType(context: NativeContext): TypeId {
  return namedType(resultVariantShape(context, resultVariants.ok).fields[0]?.type);
}

/** `Err` of `error`, of the extern's declared `Result` type (§3.12). */
export function resultErr(context: NativeContext, error: Value): Value {
  return resultVariant(context, resultVariants.err, { error });
}

/**
 * `Err` of an `Error` with `message` and `code`, of the extern's declared `Result` type; its trace
 * is the frames running the native, as an `Error` literal without one gets (§3.12).
 */
export function resultError(context: NativeContext, message: string, code: string): Value {
  const error = namedType(resultVariantShape(context, resultVariants.err).fields[0]?.type);
  return resultErr(
    context,
    structOf(context.types, error, { message, code, trace: context.trace() }),
  );
}

/** Type argument `position` of the extern's declared result: the `T` of an `Array<T>` or a `T?`. */
export function resultTypeArgument(context: NativeContext, position: number): TypeId {
  return typeArgumentOf(context.types, declaredResult(context), position);
}

/** Field `name` of a struct argument, found by the name its type declares, never by position. */
export function fieldNamed(context: NativeContext, value: Value | undefined, name: string): Value {
  if (value === undefined || !isComposite(value) || value.kind !== 'struct') {
    unreachable('Expected a struct.');
  }
  const declared = context.types[value.type];
  const position =
    declared?.kind === 'struct' ? declared.fields.findIndex((each) => each.name === name) : -1;
  return value.fields[position] ?? unreachable(`Type ${value.type} has no field '${name}'.`);
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

/** The code of every `Error` a `parse` returns (§3.10). */
const parseErrorCode = 'parse';

/** `Err` of an `Error` saying `message`, as a `parse` fails (§3.10). */
export function parseFailure(context: NativeContext, message: string): Value {
  return resultError(context, message, parseErrorCode);
}

/**
 * What a `parse` returns (§3.10): `Ok` of `read`, or, when `source` didn't read as `what` (`an
 * int`), an `Error` saying so.
 */
export function parseResult(
  context: NativeContext,
  source: string,
  what: string,
  read: Value | undefined,
): Value {
  return read === undefined
    ? parseFailure(context, `'${source}' is not ${what}.`)
    : resultOk(context, read);
}

/** Variant `name` of the enum the extern declares as its result, holding `fields` by name. */
export function resultVariant(context: NativeContext, name: string, fields: NamedFields): Value {
  return variantOf(context.types, declaredResult(context), name, fields);
}

/** Where the extern's declared enum result has variant `name`, with its declared fields. */
function resultVariantShape(context: NativeContext, name: string) {
  return variantShape(context.types, declaredResult(context), name);
}
