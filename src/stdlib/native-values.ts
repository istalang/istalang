/**
 * The values std natives receive and return, as the runtime holds them: an `int` is a bigint, a
 * `float` a number, a `string` a string, a struct its fields in declaration order, an array its
 * elements, and an optional the `Some` or `None` variant of its declared type, told apart by
 * whether it has a field.
 *
 * An argument of another shape is a bug in lowering or loading, never in the program, so reading
 * one throws a TypeError rather than panicking.
 */

import type { TypeId } from '../definition/operands.ts';
import { childValues, isComposite, type Value } from '../definition/values.ts';
import { optionalVariants, resultVariants } from '../language/well-known.ts';
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

/** A struct of the extern's declared result type, with `fields` in declaration order. */
export function resultStruct(context: NativeContext, fields: Value[]): Value {
  return { kind: 'struct', type: declaredResult(context), fields };
}

export function arrayOf(elements: readonly Value[]): Value {
  return { kind: 'array', elements: [...elements] };
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
  return value === undefined
    ? resultVariant(context, optionalVariants.none, [])
    : resultVariant(context, optionalVariants.some, [value]);
}

/** `Ok` of `value`, of the extern's declared `Result` type (§3.12). */
export function resultOk(context: NativeContext, value: Value): Value {
  return resultVariant(context, resultVariants.ok, [value]);
}

/** `Ok` of a struct of the type the extern's declared `Result` holds, with `fields` in order. */
export function resultOkStruct(context: NativeContext, fields: Value[]): Value {
  const held = resultVariantShape(context, resultVariants.ok).fields[0]?.type;
  if (held?.kind !== 'named') {
    unreachable(`${context.name} doesn't return a Result of a struct.`);
  }
  return resultOk(context, { kind: 'struct', type: held.type, fields });
}

/** `Err` of `error`, of the extern's declared `Result` type (§3.12). */
export function resultErr(context: NativeContext, error: Value): Value {
  return resultVariant(context, resultVariants.err, [error]);
}

/**
 * `Err` of an `Error` with `message` and `code`, of the extern's declared `Result` type; its trace
 * is the frames running the native, as an `Error` literal without one gets (§3.12).
 */
export function resultError(context: NativeContext, message: string, code: string): Value {
  const error = resultVariantShape(context, resultVariants.err).fields[0]?.type;
  if (error?.kind !== 'named' || context.types[error.type]?.kind !== 'struct') {
    unreachable(`${context.name} doesn't return a Result of an Error.`);
  }
  const fields = [message, code, context.trace()];
  return resultErr(context, { kind: 'struct', type: error.type, fields });
}

/** Variant `name` of the enum the extern declares as its result, holding `fields`. */
function resultVariant(context: NativeContext, name: string, fields: Value[]): Value {
  const { type, variant } = resultVariantShape(context, name);
  return { kind: 'variant', type, variant, fields };
}

/** Where variant `name` of the extern's declared enum result is, with its declared fields. */
function resultVariantShape(context: NativeContext, name: string) {
  const type = declaredResult(context);
  const declared = context.types[type];
  const variants = declared?.kind === 'enum' ? declared.variants : [];
  const variant = variants.findIndex((each) => each.name === name);
  const shape = variants[variant];
  if (shape === undefined) {
    unreachable(`${context.name} doesn't return an enum with a variant ${name}.`);
  }
  return { type, variant, fields: shape.fields };
}
