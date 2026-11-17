/**
 * Values built and read through their type entry's declaration: a struct's fields and an enum's
 * variants by name, never by position, so a value and its declaration can't drift apart
 * unnoticed. Std natives build their results this way (stdlib/values/results.ts), and the runtime
 * reads values no instruction of its own made, such as a test's outcome, the same way.
 */

import { unionLayout } from '../../foundation/language/well-known/variants.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { TypeId } from '../operands.ts';
import type { TypeDefinition, TypeReference } from '../tables/types.ts';
import { isComposite, type Value } from './values.ts';

/** Fields given by name, as a struct or a variant is built. */
export type NamedFields = Readonly<Record<string, Value>>;

/** The type entry `reference` names; undefined when it names none, as a primitive doesn't. */
function namedTypeOf(reference: TypeReference | undefined): TypeId | undefined {
  return reference?.kind === 'named' ? reference.type : undefined;
}

/** The type entry `reference` names, which it must. */
export function namedType(reference: TypeReference | undefined): TypeId {
  return namedTypeOf(reference) ?? unreachable('Expected a named type.');
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
  return declared.map(({ name }) => {
    const given = Object.hasOwn(fields, name) ? fields[name] : undefined;
    // A `Unit` field holds `null`, so only a field left out is missing.
    return given === undefined ? unreachable(`No field '${name}' is given.`) : given;
  });
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

/** Field `name` of struct value `candidate`, found by the name its type entry declares. */
export function fieldValueOf(
  types: readonly TypeDefinition[],
  candidate: Value | undefined,
  name: string,
): Value {
  if (candidate === undefined || !isComposite(candidate) || candidate.kind !== 'struct') {
    unreachable('Expected a struct.');
  }
  const declared = types[candidate.type];
  const position =
    declared?.kind === 'struct' ? declared.fields.findIndex((each) => each.name === name) : -1;
  const field = candidate.fields[position];
  return field === undefined
    ? unreachable(`Type ${candidate.type} has no field '${name}'.`)
    : field;
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

/** The value optional `optional` holds, read by its declared variant; undefined for `none`. */
export function optionalValueOf(
  types: readonly TypeDefinition[],
  optional: Value | undefined,
): Value | undefined {
  if (optional === undefined || !isComposite(optional) || optional.kind !== 'variant') {
    unreachable('Expected an optional.');
  }
  const { variant } = variantShape(types, optional.type, unionLayout.noneVariant);
  return optional.variant === variant
    ? undefined
    : variantFieldOf(types, optional, unionLayout.valueField);
}

/** Field `name` of variant value `value`, found by the name its variant declares. */
function variantFieldOf(
  types: readonly TypeDefinition[],
  value: Extract<Value, { readonly kind: 'variant' }>,
  name: string,
): Value {
  const declared = types[value.type];
  const shape = declared?.kind === 'enum' ? declared.variants[value.variant] : undefined;
  const position = shape?.fields.findIndex((field) => field.name === name) ?? -1;
  return value.fields[position] ?? unreachable(`Variant ${value.variant} has no field '${name}'.`);
}
