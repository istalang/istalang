/**
 * Which types are Sendable (§3.1): derived, never declared, except for extern types, which say so.
 *
 * Primitives are; a struct, an enum or a tuple is when everything in it is; an extern type is when
 * it is declared `sendable` and its type arguments are; a handle never is, since its values have an
 * identity (§3.18); a function type is when it is declared
 * `sendable` (§3.14); a type parameter is when constrained `is Sendable`, or by a trait that implies
 * it (`Encodable`, `Decodable`). A recursive type is sendable unless something in its cycle isn't,
 * so a type being decided counts as sendable while its own fields are.
 *
 * Code is sendable only to another instance of the same program; whether a value can go to the
 * host is whether it has a codec (rules/json-forms/), which no function type has. A host type a
 * `dispose` makes disposable has one, yet isn't sendable: its values have an identity.
 */

import { type WellKnownDeclaration, wellKnown } from '../../../language/well-known.ts';
import { isSharedStruct, type TraitDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { jsonTraits } from '../json-form.ts';
import { heldParts } from '../types/held.ts';
import type { NominalType, Type } from '../types/type.ts';

/** The traits a type parameter may be constrained by to be sendable. */
const sendableTraits: readonly WellKnownDeclaration[] = [
  wellKnown.sendable,
  ...Object.values(jsonTraits),
];

/** Whether values of `type` may leave an instance for another. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return sendable(checker, type, new Set());
}

function sendable(checker: CheckerContext, type: Type, deciding: Set<string>): boolean {
  switch (type.kind) {
    case 'primitive':
    case 'error':
      return true;
    case 'function':
      return type.isSendable;
    case 'tuple':
    case 'anonymous':
      return heldParts(checker, type).every((child) => sendable(checker, child, deciding));
    case 'parameter':
      return (
        type.declaration.kind === 'TypeParameter' &&
        checker
          .constraintsOf(type.declaration)
          .some(({ trait }) =>
            sendableTraits.some((each) => isWellKnownTrait(checker, trait, each)),
          )
      );
    case 'nominal':
      return nominalSendable(checker, type, deciding);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function nominalSendable(
  checker: CheckerContext,
  type: NominalType,
  deciding: Set<string>,
): boolean {
  const { declaration } = type.entity;
  const parts = () => heldParts(checker, type).every((part) => sendable(checker, part, deciding));
  if (declaration.kind === 'ExternStructDeclaration') {
    return declaration.isSendable && parts();
  }
  if (isSharedStruct(declaration)) {
    return false;
  }
  const key = checker.typeKeys.typeKey(type);
  if (deciding.has(key)) {
    return true;
  }
  deciding.add(key);
  const result = parts();
  deciding.delete(key);
  return result;
}

/** Whether `trait` is the prelude's Sendable. */
export function isSendableTrait(checker: CheckerContext, trait: TraitDeclaration): boolean {
  return isWellKnownTrait(checker, trait, wellKnown.sendable);
}

/** Whether `trait` is the well-known trait `declaration` names. */
export function isWellKnownTrait(
  checker: CheckerContext,
  trait: TraitDeclaration,
  declaration: WellKnownDeclaration,
): boolean {
  const entity = checker.wellKnownEntity(declaration);
  return entity?.kind === 'type' && entity.declaration === trait;
}
