/**
 * Values built and read through their type entry's declaration: a struct's fields and an enum's
 * variants by name, never by position, so a value and its declaration can't drift apart
 * unnoticed. Std natives build their results this way (stdlib/native-values.ts), and so does the
 * scheduler where it hands an instance a value no instruction made, such as another instance's
 * end (§9). `Result`'s `Ok` and `Err(Error)` are built here once for both (§3.12).
 */

import {
  optionalValueField,
  optionalVariants,
  resultFields,
  resultVariants,
} from '../language/well-known.ts';
import { unreachable } from '../structures/unreachable.ts';
import type { TypeId } from './operands.ts';
import type { TypeDefinition, TypeReference } from './types.ts';
import { isComposite, type Value } from './values.ts';

/** Fields given by name, as a struct or a variant is built. */
export type NamedFields = Readonly<Record<string, Value>>;

/** The type entry `reference` names; undefined when it names none, as a primitive doesn't. */
export function namedTypeOf(reference: TypeReference | undefined): TypeId | undefined {
  return reference?.kind === 'named' ? reference.type : undefined;
}

/** The type entry `reference` names, which it must. */
export function namedType(reference: TypeReference | undefined): TypeId {
  return namedTypeOf(reference) ?? unreachable('Expected a named type.');
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

/** The declared type of field `field` of variant `variant` of enum entry `type`. */
function variantFieldType(
  types: readonly TypeDefinition[],
  type: TypeId,
  variant: string,
  field: string,
): TypeReference {
  const declared = variantShape(types, type, variant).fields.find(({ name }) => name === field);
  return declared?.type ?? unreachable(`Variant ${variant} of type ${type} has no field ${field}.`);
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
    : variantOf(types, type, optionalVariants.some, { [optionalValueField]: value });
}

/** The value optional `optional` holds, read by its declared variant; undefined for `None`. */
export function optionalValueOf(
  types: readonly TypeDefinition[],
  optional: Value | undefined,
): Value | undefined {
  if (optional === undefined || !isComposite(optional) || optional.kind !== 'variant') {
    unreachable('Expected an optional.');
  }
  const { variant } = variantShape(types, optional.type, optionalVariants.some);
  return optional.variant === variant
    ? variantFieldOf(types, optional, optionalValueField)
    : undefined;
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

/** What an `Error` says (§3.12). */
export interface ErrorFields {
  readonly message: string;
  readonly code: string;
  readonly trace: string;
}

/** The type `Result` entry `result` holds when `Ok`. */
export function okTypeOf(types: readonly TypeDefinition[], result: TypeId): TypeId {
  return namedType(variantFieldType(types, result, resultVariants.ok, resultFields.ok));
}

/** `Ok` of `value`, of `Result` entry `result` (§3.12). */
export function okOf(types: readonly TypeDefinition[], result: TypeId, value: Value): Value {
  return variantOf(types, result, resultVariants.ok, { [resultFields.ok]: value });
}

/** `Err` of `error`, of `Result` entry `result` (§3.12). */
export function errOf(types: readonly TypeDefinition[], result: TypeId, error: Value): Value {
  return variantOf(types, result, resultVariants.err, { [resultFields.err]: error });
}

/** `Err` of an `Error` saying `fields`, of `Result` entry `result` (§3.12). */
export function errorOf(
  types: readonly TypeDefinition[],
  result: TypeId,
  fields: ErrorFields,
): Value {
  const error = namedType(variantFieldType(types, result, resultVariants.err, resultFields.err));
  return errOf(types, result, structOf(types, error, { ...fields }));
}
