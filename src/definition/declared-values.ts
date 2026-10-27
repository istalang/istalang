/**
 * Values built and read through their type entry's declaration: a struct's fields and an enum's
 * variants by name, never by position, so a value and its declaration can't drift apart
 * unnoticed. Std natives build their results this way (stdlib/native-values.ts), and so does the
 * scheduler where it hands an instance a value no instruction made, such as another instance's
 * end (§9).
 */

import { optionalVariants } from '../language/well-known.ts';
import { unreachable } from '../structures/unreachable.ts';
import type { TypeId } from './operands.ts';
import type { TypeDefinition, TypeReference } from './types.ts';
import type { Value } from './values.ts';

/** Fields given by name, as a struct or a variant is built. */
export type NamedFields = Readonly<Record<string, Value>>;

/** The type entry `reference` names. */
export function namedType(reference: TypeReference | undefined): TypeId {
  if (reference?.kind !== 'named') {
    unreachable('Expected a named type.');
  }
  return reference.type;
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
  return declared.map(({ name }) => fields[name] ?? unreachable(`No field '${name}' is given.`));
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

/** Variant `name` of enum entry `type`, holding `fields` by name. */
export function variantOf(
  types: readonly TypeDefinition[],
  type: TypeId,
  name: string,
  fields: NamedFields,
): Value {
  const { variant, fields: declared } = variantShape(types, type, name);
  return { kind: 'variant', type, variant, fields: inDeclaredOrder(declared, fields) };
}

/** Where enum entry `type` has variant `name`, with its declared fields. */
export function variantShape(types: readonly TypeDefinition[], type: TypeId, name: string) {
  const declared = types[type];
  const variants = declared?.kind === 'enum' ? declared.variants : [];
  const variant = variants.findIndex((each) => each.name === name);
  const shape = variants[variant];
  if (shape === undefined) {
    unreachable(`Type ${type} isn't an enum with a variant ${name}.`);
  }
  return { variant, fields: shape.fields };
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
