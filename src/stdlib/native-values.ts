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
import type { TypeDefinition, TypeReference } from '../definition/types.ts';
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

/** Fields given by name, as a struct or a variant is built (`structOf`, `resultVariant`). */
type NamedFields = Readonly<Record<string, Value>>;

/** The type entry the extern's declared result names: a struct or an enum. */
function declaredResult(context: NativeContext): TypeId {
  return context.resultType ?? unreachable(`${context.name} returns no named type.`);
}

/** A struct of the extern's declared result type, with `fields` by name. */
export function resultStruct(context: NativeContext, fields: NamedFields): Value {
  return structOf(context.types, declaredResult(context), fields);
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
  return optionalOf(context.types, declaredResult(context), value);
}

/** `Ok` of `value`, of the extern's declared `Result` type (§3.12). */
export function resultOk(context: NativeContext, value: Value): Value {
  return resultVariant(context, resultVariants.ok, { value });
}

/** A struct of the type the extern's declared `Result` holds when `Ok`, with `fields` by name. */
export function okStruct(context: NativeContext, fields: NamedFields): Value {
  const held = namedType(resultVariantShape(context, resultVariants.ok).fields[0]?.type);
  return structOf(context.types, held, fields);
}

/** `Err` of `error`, of the extern's declared `Result` type (§3.12). */
export function resultErr(context: NativeContext, error: Value): Value {
  return resultVariant(context, resultVariants.err, { error });
}

/**
 * `Err` of an `Error` with `message` and `code`, of the extern's declared `Result` type; its trace
 * is the frames running the native, as an `Error` literal without one gets (§3.12).
 */
function resultError(context: NativeContext, message: string, code: string): Value {
  const error = namedType(resultVariantShape(context, resultVariants.err).fields[0]?.type);
  return resultErr(
    context,
    structOf(context.types, error, { message, code, trace: context.trace() }),
  );
}

/** The type entry `reference` names. */
export function namedType(reference: TypeReference | undefined): TypeId {
  if (reference?.kind !== 'named') {
    unreachable('Expected a named type.');
  }
  return reference.type;
}

/** Type argument `position` of the extern's declared result: the `T` of an `Array<T>` or a `T?`. */
export function resultTypeArgument(context: NativeContext, position: number): TypeId {
  return typeArgumentOf(context.types, declaredResult(context), position);
}

/** The declared type of field `name` of struct entry `type`. */
export function fieldTypeOf(
  types: readonly TypeDefinition[],
  type: TypeId,
  name: string,
): TypeReference {
  const declared = types[type];
  const field =
    declared?.kind === 'struct' ? declared.fields.find((each) => each.name === name) : undefined;
  return field?.type ?? unreachable(`Type ${type} isn't a struct with a field ${name}.`);
}

/** Type argument `position` of type entry `type`, a named type: `T` of an `Array<T>`. */
export function typeArgumentOf(
  types: readonly TypeDefinition[],
  type: TypeId,
  position: number,
): TypeId {
  return namedType(types[type]?.arguments[position]);
}

/**
 * `fields` in the order `declared` lists them: a composite is built through its declaration, never
 * by position, so a field this doesn't give fails loudly here.
 */
function inDeclaredOrder(
  declared: readonly { readonly name: string }[],
  fields: NamedFields,
): Value[] {
  return declared.map(
    ({ name }) => fields[name] ?? unreachable(`A native gives no field '${name}'.`),
  );
}

/** A struct of type entry `type` with `fields` by name. */
export function structOf(
  types: readonly TypeDefinition[],
  type: TypeId,
  fields: NamedFields,
): Value {
  const declared = types[type];
  if (declared?.kind !== 'struct') {
    unreachable(`Type ${type} isn't a struct.`);
  }
  return { kind: 'struct', type, fields: inDeclaredOrder(declared.fields, fields) };
}

/** An optional of type entry `type`: `Some` of `value`, or `None` without one. */
export function optionalOf(
  types: readonly TypeDefinition[],
  type: TypeId,
  value: Value | undefined,
): Value {
  return value === undefined
    ? variantOf(types, type, optionalVariants.none, {})
    : variantOf(types, type, optionalVariants.some, { value });
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

/** Variant `name` of enum entry `type`, holding `fields` by name. */
function variantOf(
  types: readonly TypeDefinition[],
  type: TypeId,
  name: string,
  fields: NamedFields,
): Value {
  const { variant, fields: declared } = variantShape(types, type, name);
  return { kind: 'variant', type, variant, fields: inDeclaredOrder(declared, fields) };
}

/** Where the extern's declared enum result has variant `name`, with its declared fields. */
function resultVariantShape(context: NativeContext, name: string) {
  return variantShape(context.types, declaredResult(context), name);
}

/** Where enum entry `type` has variant `name`, with its declared fields. */
function variantShape(types: readonly TypeDefinition[], type: TypeId, name: string) {
  const declared = types[type];
  const variants = declared?.kind === 'enum' ? declared.variants : [];
  const variant = variants.findIndex((each) => each.name === name);
  const shape = variants[variant];
  if (shape === undefined) {
    unreachable(`Type ${type} isn't an enum with a variant ${name}.`);
  }
  return { variant, fields: shape.fields };
}
