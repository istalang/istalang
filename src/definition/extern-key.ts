/**
 * The key that binds an extern function-table entry to its native (docs/arch/definition.md,
 * "Externs"): the declaring module's canonical name, the function's declared name, and its
 * declared parameter types, `prelude.add(Int, Float)`.
 *
 * - Keys are persisted inside Definitions and matched against host tables, so they are an
 *   identity, never a message. Their types are rendered here and nowhere else: every named type is
 *   module-qualified (`prelude.Optional<Int>`, never `Int?`), so two modules' `Point`s never share
 *   a key, and no wording elsewhere can change one.
 * - Types are the declared ones, type parameters included (`prelude.push(&prelude.Array<T>, T)`),
 *   so every instantiation of a generic extern shares one native while overloads differ.
 * - Lowering builds keys from declarations, and natives from their own tables, both through
 *   `externKey`, so the two can't drift apart. A natives table spells its types with the builders
 *   below.
 * - A rest parameter is spelled with its `...`, `strings.format(String, ...prelude.Array<String>)`:
 *   its native takes the array the call collects (§3.3).
 * - An extern constant has no parameters to tell overloads apart, so its key is its qualified
 *   name alone: `purchase.approvalDeadline` (§9).
 */

import type { PrimitiveName } from '../foundation/language/primitives.ts';
import { qualifiedName } from '../foundation/language/well-known/index.ts';

/** A declared type, as a key spells it. */
export type KeyType =
  | { readonly kind: 'primitive'; readonly name: string }
  | { readonly kind: 'named'; readonly name: string; readonly arguments: readonly KeyType[] }
  | { readonly kind: 'parameter'; readonly name: string }
  | { readonly kind: 'tuple'; readonly elements: readonly KeyType[] }
  /** An anonymous struct (§3.1), spelled by its fields, which are all it has. */
  | {
      readonly kind: 'anonymous';
      readonly fields: readonly { readonly name: string; readonly type: KeyType }[];
    }
  | {
      readonly kind: 'function';
      readonly async: boolean;
      readonly parameters: readonly KeyType[];
      readonly result: KeyType;
    }
  /** `any A & B` (§3.10), spelled by its traits, sorted, since they are a set. */
  | { readonly kind: 'any'; readonly traits: readonly KeyType[] }
  /** A literal type (§2), spelled as its literal: `"draft"`, `-1`, `true`. */
  | { readonly kind: 'literal'; readonly text: string }
  /**
   * `A | B` (§2), spelled by its members, sorted, since they are a set; `T | None` is spelled
   * `prelude.Optional<T>` instead, as keys spelled it before unions, so no host table changes.
   */
  | { readonly kind: 'union'; readonly members: readonly KeyType[] };

export interface ExternSignature {
  /** The declaring module's canonical name, such as `prelude` or `purchase/approve`. */
  readonly module: string;
  /** The declared name, with its owner type for a static function: `Slot.create`. */
  readonly name: string;
  readonly parameters: readonly KeyParameter[];
}

/** A parameter as a key spells it: its type, and how it is passed. */
interface KeyParameter {
  readonly type: KeyType;
  readonly passing: 'value' | 'reference' | 'rest';
}

/** A primitive type, as a key spells it. */
function primitiveKey(name: PrimitiveName): KeyType {
  return { kind: 'primitive', name };
}

/** A type as a natives table writes it: a key type, or a primitive's name. */
export type WrittenType = KeyType | PrimitiveName;

/** A named type, module-qualified, with its type arguments: `time.Time`, `prelude.Array<T>`. */
export function namedKey(name: string, ...typeArguments: readonly WrittenType[]): KeyType {
  return { kind: 'named', name, arguments: typeArguments.map(typeOf) };
}

/** A function type, as a key spells it: `async fn() -> T`; a key doesn't tell sendable apart. */
export function functionKey(
  isAsync: boolean,
  parameters: readonly WrittenType[],
  result: WrittenType,
): KeyType {
  return {
    kind: 'function',
    async: isAsync,
    parameters: parameters.map(typeOf),
    result: typeOf(result),
  };
}

/** A type parameter of the extern's own, as declared: the `T` of `prelude.Array<T>`. */
export function parameterKey(name: string): KeyType {
  return { kind: 'parameter', name };
}

/** A parameter the extern takes by `&`, as a natives table writes it (§3.7). */
export interface ReferenceKey {
  readonly reference: KeyType;
}

export function referenceKey(type: KeyType): ReferenceKey {
  return { reference: type };
}

/** A rest parameter, as a natives table writes it (§3.3). */
export interface RestKey {
  readonly rest: KeyType;
}

export function restKey(type: KeyType): RestKey {
  return { rest: type };
}

/**
 * A parameter as a natives table writes it: a type, a primitive's name, a `referenceKey` or a
 * `restKey`.
 */
export type NativeParameter = WrittenType | ReferenceKey | RestKey;

/**
 * The key of extern `name` of `module` taking `parameters`, as a natives table writes it: each a
 * type taken by value, or one `referenceKey` marks as taken by `&`.
 */
export function nativeKey(
  module: string,
  name: string,
  ...parameters: readonly NativeParameter[]
): string {
  return externKey({
    module,
    name,
    parameters: parameters.map(keyParameterOf),
  });
}

function keyParameterOf(parameter: NativeParameter): KeyParameter {
  if (typeof parameter !== 'string' && 'reference' in parameter) {
    return { type: parameter.reference, passing: 'reference' };
  }
  if (typeof parameter !== 'string' && 'rest' in parameter) {
    return { type: parameter.rest, passing: 'rest' };
  }
  return { type: typeOf(parameter), passing: 'value' };
}

function typeOf(parameter: WrittenType): KeyType {
  return typeof parameter === 'string' ? primitiveKey(parameter) : parameter;
}

export function externKey(signature: ExternSignature): string {
  const parameters = signature.parameters.map(
    (parameter) => `${markerOf(parameter)}${keyTypeText(parameter.type)}`,
  );
  return `${qualifiedName(signature)}(${parameters.join(', ')})`;
}

/** What a key writes before a parameter's type: `&` for a reference, `...` for the rest. */
function markerOf(parameter: KeyParameter): string {
  switch (parameter.passing) {
    case 'reference':
      return '&';
    case 'rest':
      return '...';
    case 'value':
      return '';
    default: {
      const unhandled: never = parameter.passing;
      return unhandled;
    }
  }
}

/**
 * A type as keys and function-table names spell it: module-qualified, without sugar. Tuple and
 * function types read as `checker/types/type/type-text.ts` writes them for messages; the two stay
 * apart on purpose: a key is a persisted identity, so a change of wording there must never reach
 * it.
 */
export function keyTypeText(type: KeyType): string {
  switch (type.kind) {
    case 'primitive':
    case 'parameter':
      return type.name;
    case 'named':
      return type.arguments.length === 0
        ? type.name
        : `${type.name}<${type.arguments.map(keyTypeText).join(', ')}>`;
    case 'tuple':
      return `(${type.elements.map(keyTypeText).join(', ')}${type.elements.length === 1 ? ',' : ''})`;
    case 'anonymous':
      return `struct { ${type.fields.map((field) => `${field.name}: ${keyTypeText(field.type)}`).join(', ')} }`;
    case 'function':
      return `${type.async ? 'async ' : ''}fn(${type.parameters.map(keyTypeText).join(', ')}) -> ${keyTypeText(type.result)}`;
    case 'any':
      return `any ${type.traits.map(keyTypeText).sort().join(' & ')}`;
    case 'literal':
      return type.text;
    case 'union':
      return type.members.map(keyTypeText).sort().join(' | ');
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
