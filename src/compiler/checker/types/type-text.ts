/**
 * How a type reads in messages and in the names of instantiations: the way a programmer would
 * write it, `Pair<int, string>`, `int?`, `fn(int) -> bool`.
 *
 * Nominal types print their declared name without a module: inside a message the source location
 * already says where.
 */

import { wellKnown } from '../../../language/well-known.ts';
import {
  type AnonymousStructType,
  type Constraint,
  isSharedValueType,
  type NominalType,
  type Type,
} from './type.ts';

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
  if (
    declaration.kind === 'EnumDeclaration' &&
    declaration.name.text === wellKnown.optional.name &&
    type.arguments.length === 1 &&
    only !== undefined
  ) {
    return only.kind === 'function' ? `(${typeText(only)})?` : `${typeText(only)}?`;
  }
  return parameterizedText(declaration.name.text, type.arguments);
}

/**
 * An anonymous struct as written: `*Name<Arguments>` for the value behind a shared struct (§3.18),
 * or `struct { … }` for any other.
 */
function anonymousText(type: AnonymousStructType): string {
  if (isSharedValueType(type)) {
    return `*${parameterizedText(type.origin.name.text, type.arguments)}`;
  }
  return `struct { ${type.fields.map((field) => `${field.name}: ${typeText(field.type)}`).join('; ')} }`;
}

function parameterizedText(name: string, typeArguments: readonly Type[]): string {
  return typeArguments.length === 0 ? name : `${name}<${typeArguments.map(typeText).join(', ')}>`;
}
