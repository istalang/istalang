/**
 * How a type reads in messages and in the names of instantiations: the way a programmer would
 * write it, `Pair<int, string>`, `int?`, `fn(int) -> bool`.
 *
 * Nominal types print their declared name without a module: inside a message the source location
 * already says where.
 */

import { optionalVariants, wellKnown } from '../../../language/well-known.ts';
import {
  type EnumDeclaration,
  type StructDeclaration,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type { AnonymousStructType, Constraint, NominalType, Type } from './type.ts';

/**
 * `type` as source would spell it. Extern keys spell types too (definition/extern-key.ts), but
 * apart on purpose: they are a persisted identity, and must never follow a change of wording here.
 */
export function typeText(type: Type): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'nominal':
      return nominalTypeText(type);
    case 'anonymous':
      return anonymousText(type);
    case 'tuple':
      return `(${type.elements.map(typeText).join(', ')}${type.elements.length === 1 ? ',' : ''})`;
    case 'function': {
      const parameters = type.parameters.map(
        (parameter) => `${parameter.reference ? '&' : ''}${typeText(parameter.type)}`,
      );
      if (type.pack !== undefined) {
        parameters.push(`...${typeText(type.pack)}`);
      }
      const prefix = `${type.isSendable ? 'sendable ' : ''}${type.isAsync ? 'async ' : ''}`;
      return `${prefix}fn(${parameters.join(', ')}) -> ${typeText(type.result)}`;
    }
    case 'parameter':
      return type.declaration.kind === 'TraitDeclaration' ? 'Self' : type.declaration.name.text;
    case 'any':
      return `any ${type.constraints.map(constraintText).join(' & ')}`;
    case 'error':
      return '?';
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * A constraint of an `any` type as written: its trait's own `Self`, standing for each value's own
 * type, is the default it came from, so trailing ones are left out (`Iterable<int>`).
 */
function constraintText({ trait, arguments: typeArguments }: Constraint): string {
  const isOwnSelf = (type: Type | undefined) =>
    type?.kind === 'parameter' && type.declaration === trait;
  let written = typeArguments.length;
  while (written > 0 && isOwnSelf(typeArguments[written - 1])) {
    written -= 1;
  }
  return parameterizedText(trait.name.text, typeArguments.slice(0, written));
}

/**
 * `Optional<T>` reads as `T?` (§2), a function type in parentheses, since its result would take
 * the `?`; anything else as `Name<Arguments>`.
 */
function nominalTypeText(type: NominalType): string {
  const { declaration } = type.entity;
  const [only] = type.arguments;
  if (isOptionalDeclaration(declaration) && type.arguments.length === 1 && only !== undefined) {
    return only.kind === 'function' ? `(${typeText(only)})?` : `${typeText(only)}?`;
  }
  return parameterizedText(declaration.name.text, type.arguments);
}

/** Whether `declaration` is the prelude's `Optional<T>` enum (`Some` and `None`). */
function isOptionalDeclaration(declaration: NominalType['entity']['declaration']): boolean {
  if (
    declaration.kind !== 'EnumDeclaration' ||
    declaration.name.text !== wellKnown.optional.name ||
    typeParametersOf(declaration.typeParameters).length !== 1
  ) {
    return false;
  }
  return sameVariantNames(declaration, [optionalVariants.some, optionalVariants.none]);
}

function sameVariantNames(declaration: EnumDeclaration, expected: readonly string[]): boolean {
  const names = declaration.variants.flatMap((variant) =>
    variant.kind === 'Variant' ? [variant.name.text] : [],
  );
  return names.length === expected.length && names.every((name, index) => name === expected[index]);
}

/**
 * An anonymous struct as written: `*Name<Arguments>` for the value behind a shared struct (§3.18),
 * or `struct { … }` for any other.
 */
function anonymousText(type: AnonymousStructType): string {
  if (type.origin.kind === 'StructDeclaration') {
    const typeArguments = sharedTypeArguments(type.origin, type);
    return `*${parameterizedText(type.origin.name.text, typeArguments)}`;
  }
  return `struct { ${type.fields.map((field) => `${field.name}: ${typeText(field.type)}`).join('; ')} }`;
}

/** The type arguments of a shared struct `declaration` recovered from its value's `fields`. */
function sharedTypeArguments(
  declaration: StructDeclaration,
  value: AnonymousStructType,
): readonly Type[] {
  const parameters = typeParametersOf(declaration.typeParameters);
  if (parameters.length === 0) {
    return [];
  }
  const parameterNames = new Set(parameters.map((parameter) => parameter.name.text));
  const found = new Map<string, Type>();
  for (const field of value.fields) {
    const declaredType = field.declared?.node.type;
    if (declaredType !== undefined) {
      collectTypeArguments(declaredType, field.type, parameterNames, found);
    }
  }
  return parameters.flatMap((parameter) => {
    const argument = found.get(parameter.name.text);
    return argument === undefined ? [] : [argument];
  });
}

function collectTypeArguments(
  node: TypeNode,
  actual: Type,
  parameters: ReadonlySet<string>,
  found: Map<string, Type>,
): void {
  switch (node.kind) {
    case 'ParenthesizedType':
    case 'ReferenceType':
      collectTypeArguments(
        node.kind === 'ParenthesizedType' ? node.inner : node.referent,
        actual,
        parameters,
        found,
      );
      return;
    case 'OptionalType':
      if (
        actual.kind === 'nominal' &&
        isOptionalDeclaration(actual.entity.declaration) &&
        actual.arguments[0] !== undefined
      ) {
        collectTypeArguments(node.inner, actual.arguments[0], parameters, found);
      }
      return;
    case 'TupleType':
      if (actual.kind === 'tuple') {
        node.elements.forEach((element, index) => {
          const item = actual.elements[index];
          if (item !== undefined) {
            collectTypeArguments(element, item, parameters, found);
          }
        });
      }
      return;
    case 'NamedType': {
      const [first] = node.path;
      if (
        node.path.length === 1 &&
        node.typeArguments.length === 0 &&
        first !== undefined &&
        parameters.has(first.text)
      ) {
        found.set(first.text, actual);
        return;
      }
      if (actual.kind === 'nominal') {
        node.typeArguments.forEach((argument, index) => {
          const item = actual.arguments[index];
          if (item !== undefined) {
            collectTypeArguments(argument, item, parameters, found);
          }
        });
      }
      return;
    }
    default:
      return;
  }
}

function parameterizedText(name: string, typeArguments: readonly Type[]): string {
  return typeArguments.length === 0 ? name : `${name}<${typeArguments.map(typeText).join(', ')}>`;
}
