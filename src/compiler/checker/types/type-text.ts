/**
 * How a type reads in messages (and M7's hovers): the way a programmer would write it,
 * `Pair<Int, String>`, `Int?`, `fn(Int) -> Bool`.
 *
 * Nominal types print their declared name without a module: inside a message the source location
 * already says where. A type written through an alias reads as the alias, with its arguments
 * (§3.17), as the programmer wrote it; any other shape reads as its fields, never as a key.
 */

import { selfType, wellKnown } from '../../../language/well-known.ts';
import type {
  AnonymousStructType,
  Constraint,
  FunctionType,
  NominalType,
  ParameterSlot,
  Type,
} from './type.ts';

/**
 * `type` as source would spell it. Extern keys spell types too (definition/extern-key.ts), but
 * apart on purpose: they are a persisted identity, and must never follow a change of wording here.
 */
export function typeText(type: Type): string {
  if (type.alias !== undefined) {
    return parameterizedText(type.alias.declaration.name.text, type.alias.arguments);
  }
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
      const { head, parameters, tail } = functionTypeParts(type);
      return `${head}(${parameters.join(', ')})${tail}`;
    }
    case 'parameter':
      return type.declaration.kind === 'TraitDeclaration' ? selfType : type.declaration.name.text;
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
 * A function type's spelling in parts: what stands before its parameters, each parameter, and what
 * follows them, for tools that mark one parameter (signature help).
 */
export function functionTypeParts(type: FunctionType): {
  readonly head: string;
  readonly parameters: readonly string[];
  readonly tail: string;
} {
  const parameters = type.parameters.map(slotText);
  if (type.pack !== undefined) {
    parameters.push(`...${typeText(type.pack)}`);
  }
  return {
    head: `${type.isSendable ? 'sendable ' : ''}${type.isAsync ? 'async ' : ''}fn`,
    parameters,
    tail: ` -> ${typeText(type.result)}`,
  };
}

/** A parameter's type as written: `&T` for one passed by reference (§3.7). */
export function slotText({ type, reference }: ParameterSlot): string {
  return `${reference ? '&' : ''}${typeText(type)}`;
}

/**
 * A constraint of an `any` type as written: its trait's own `Self`, standing for each value's own
 * type, is the default it came from, so trailing ones are left out (`Iterable<Int>`).
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
    const needsParentheses = only.kind === 'function' && only.alias === undefined;
    return needsParentheses ? `(${typeText(only)})?` : `${typeText(only)}?`;
  }
  return parameterizedText(declaration.name.text, type.arguments);
}

/** A shape as written, its fields in the name order it keeps them in (§3.1). */
function anonymousText(type: AnonymousStructType): string {
  return `struct { ${type.fields.map((field) => `${field.name}: ${typeText(field.type)}`).join('; ')} }`;
}

function parameterizedText(name: string, typeArguments: readonly Type[]): string {
  return typeArguments.length === 0 ? name : `${name}<${typeArguments.map(typeText).join(', ')}>`;
}
