/**
 * How a type reads in messages (and M7's hovers): the way a programmer would write it,
 * `Pair<Int, String>`, `Int?`, `fn(Int) -> Bool`, `"draft" | "sent"`.
 *
 * Nominal types print their declared name without a module: inside a message the source location
 * already says where. A type written through an alias reads as the alias, with its arguments
 * (§3.17), as the programmer wrote it; any other shape reads as its fields, never as a key.
 */

import { selfType } from '../../../language/well-known.ts';
import type { TypeParameter } from '../../syntax/declarations.ts';
import type { RestPattern } from '../../syntax/patterns.ts';
import type { MappedParts } from './computed-types.ts';
import {
  type AliasUse,
  type AnonymousStructType,
  type Constraint,
  type FunctionType,
  isPrimitive,
  type NominalType,
  type ParameterSlot,
  type Type,
  type TypeParameterType,
  type UnionType,
} from './type.ts';

/** `of.name`, an associated type as written (§3.1). */
function associatedText(of: Type, name: string): string {
  return `${ownerText(of)}.${name}`;
}

/** A type as it reads before `.` or `[`: parenthesized where it wouldn't bind tightest (§3.1). */
function ownerText(type: Type): string {
  const text = typeText(type);
  const bindsLoosely =
    type.alias === undefined &&
    (type.kind === 'union' || type.kind === 'function' || type.kind === 'any');
  return bindsLoosely ? `(${text})` : text;
}

/**
 * `type` as written and, when it was written through an alias, an associated type or a struct's
 * keys, what that names, `keyof Settings = "region" | "retries"`: what a tool shows of a type, so a
 * spelling never hides what it stands for (§3.17). A spelling naming only itself, an unreduced one,
 * shows once.
 */
export function writtenAndNamedText(type: Type): string {
  const written = typeText(type);
  if (type.alias === undefined) {
    return written;
  }
  const named = typeText({ ...type, alias: undefined });
  return named === written ? written : `${written} = ${named}`;
}

/**
 * `type` as source would spell it. Extern keys spell types too (definition/extern-key.ts), but
 * apart on purpose: they are a persisted identity, and must never follow a change of wording here.
 */
export function typeText(type: Type): string {
  const { alias } = type;
  if (alias !== undefined) {
    return spellingText(alias);
  }
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'nominal':
      return nominalTypeText(type);
    case 'anonymous':
      return type.recursion === undefined
        ? anonymousText(type)
        : parameterizedText(type.recursion.declaration.name.text, type.recursion.arguments);
    case 'recursive':
      return parameterizedText(type.declaration.name.text, type.arguments);
    case 'tuple':
      return `(${type.elements.map(typeText).join(', ')}${type.elements.length === 1 ? ',' : ''})`;
    case 'function': {
      const { head, parameters, tail } = functionTypeParts(type);
      return `${head}(${parameters.join(', ')})${tail}`;
    }
    case 'parameter':
      return parameterText(type);
    case 'any':
      return `any ${type.constraints.map(constraintText).join(' & ')}`;
    case 'literal':
      return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value);
    case 'union':
      return unionText(type);
    case 'associated':
      return associatedText(type.of, type.name);
    case 'field':
      return `${ownerText(type.of)}[${typeText(type.key)}]`;
    case 'keys':
      return keysText(type.of, type.without);
    case 'mapped':
      return mappedText(type);
    case 'match':
      return parameterizedText(type.declaration.name.text, type.arguments);
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

function nominalTypeText(type: NominalType): string {
  return parameterizedText(type.entity.declaration.name.text, type.arguments);
}

/**
 * A union as written, its members in the order first written (§2): `T?` for `T | None`, and a
 * function type member in parentheses, since its result would take what follows it.
 */
function unionText(type: UnionType): string {
  const member = (each: Type) =>
    each.kind === 'function' && each.alias === undefined ? `(${typeText(each)})` : typeText(each);
  const others = type.members.filter((each) => !isPrimitive(each, 'None'));
  const [only] = others;
  return others.length === 1 && only !== undefined
    ? `${member(only)}?`
    : type.members.map(member).join(' | ');
}

/** A shape as written, its fields in the name order it keeps them in (§3.1). */
/**
 * The keys of a struct type not known yet that its constraints don't name: `keyof S`, the names
 * also left out following it, as a mapped entry's or a rest's (§3.1).
 */
function keysText(of: Type, without: readonly string[]): string {
  const keys = `keyof ${ownerText(of)}`;
  return without.length === 0
    ? keys
    : `${keys} except ${without.map((name) => JSON.stringify(name)).join(' | ')}`;
}

/** A mapped struct type as written: `{ id: String; [F in keyof S]: S[F]? }` (§3.1). */
function mappedText(type: MappedParts): string {
  const named = type.named.map((field) => `${field.name}: ${typeText(field.type)}`);
  const mapped = `[${boundName(type.parameter)} in ${typeText(type.keys)}]: ${typeText(type.value)}`;
  return `{ ${[...named, mapped].join('; ')} }`;
}

function anonymousText(type: AnonymousStructType): string {
  return `struct { ${type.fields.map((field) => `${field.name}: ${typeText(field.type)}`).join('; ')} }`;
}

function parameterizedText(name: string, typeArguments: readonly Type[]): string {
  return typeArguments.length === 0 ? name : `${name}<${typeArguments.map(typeText).join(', ')}>`;
}

/**
 * A type parameter's name: its own, `Self` for a trait's; a field loop's key for the fields a
 * struct constraint leaves unnamed reads as the keys it ranges over (§4).
 */
export function parameterText(type: TypeParameterType): string {
  const { declaration } = type;
  switch (declaration.kind) {
    case 'TraitDeclaration':
      return selfType;
    case 'FieldHeader':
      return type.within === undefined ? 'keyof …' : typeText(type.within);
    default:
      return boundName(declaration);
  }
}

/**
 * The name a parameter a declaration or a mapped type binds is written with; a struct pattern's
 * rest binds one for its keys unwritten, read as a mapped entry's conventional `F` (§3.11).
 */
function boundName(declaration: TypeParameter | RestPattern): string {
  return declaration.kind === 'RestPattern' ? 'F' : declaration.name.text;
}

/** A spelling as source writes it: an alias with its arguments, an associated type, or keys. */
function spellingText(alias: AliasUse): string {
  switch (alias.kind) {
    case 'alias':
      return parameterizedText(alias.declaration.name.text, alias.arguments);
    case 'associated':
      return associatedText(alias.of, alias.name);
    case 'keys':
      return `keyof ${ownerText(alias.of)}`;
    default: {
      const unhandled: never = alias;
      return unhandled;
    }
  }
}
