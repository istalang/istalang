/**
 * The key that binds an extern function-table entry to its native (docs/arch/definition.md,
 * "Externs"): the declaring module's canonical name, the function's declared name, and its
 * declared parameter types, `prelude.add(int, float)`.
 *
 * - Keys are persisted inside Definitions and matched against host tables, so they are an
 *   identity, never a message. Their types are rendered here and nowhere else: every named type is
 *   module-qualified (`prelude.Optional<int>`, never `int?`), so two modules' `Point`s never share
 *   a key, and no wording elsewhere can change one.
 * - Types are the declared ones, type parameters included (`prelude.push(&prelude.Array<T>, T)`),
 *   so every instantiation of a generic extern shares one native while overloads differ.
 * - Lowering builds keys from declarations, and natives from their own tables, both through
 *   `externKey`, so the two can't drift apart. A natives table spells its types with the builders
 *   below.
 */

import type { PrimitiveName } from '../language/primitives.ts';

/** A declared type, as a key spells it. */
export type KeyType =
  | { readonly kind: 'primitive'; readonly name: string }
  | { readonly kind: 'named'; readonly name: string; readonly arguments: readonly KeyType[] }
  | { readonly kind: 'parameter'; readonly name: string }
  | { readonly kind: 'tuple'; readonly elements: readonly KeyType[] }
  | {
      readonly kind: 'function';
      readonly async: boolean;
      readonly parameters: readonly KeyType[];
      readonly result: KeyType;
    };

export interface ExternSignature {
  /** The declaring module's canonical name, such as `prelude` or `purchase/approve`. */
  readonly module: string;
  /** The declared name, with its owner type for a static function: `Slot.create`. */
  readonly name: string;
  readonly parameters: readonly { readonly type: KeyType; readonly reference: boolean }[];
}

/** A primitive type, as a key spells it. */
export function primitiveKey(name: PrimitiveName): KeyType {
  return { kind: 'primitive', name };
}

/** A named type without type arguments, module-qualified: `time.Time`. */
export function namedKey(name: string): KeyType {
  return { kind: 'named', name, arguments: [] };
}

/** The key of extern `name` of `module` taking `parameters` by value, as a natives table writes it. */
export function byValueKey(
  module: string,
  name: string,
  ...parameters: readonly KeyType[]
): string {
  return externKey({
    module,
    name,
    parameters: parameters.map((type) => ({ type, reference: false })),
  });
}

export function externKey(signature: ExternSignature): string {
  const parameters = signature.parameters.map(
    (parameter) => `${parameter.reference ? '&' : ''}${keyTypeText(parameter.type)}`,
  );
  return `${signature.module}.${signature.name}(${parameters.join(', ')})`;
}

/**
 * Spells tuple and function types as `checker/types/type-text.ts` does for messages. The two stay
 * apart on purpose: a key is a persisted identity, so a change of wording there must never reach it.
 */
function keyTypeText(type: KeyType): string {
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
    case 'function':
      return `${type.async ? 'async ' : ''}fn(${type.parameters.map(keyTypeText).join(', ')}) -> ${keyTypeText(type.result)}`;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
