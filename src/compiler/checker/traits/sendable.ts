/**
 * Which types are Sendable (§3.1): derived, never declared, except for extern types, which say so.
 *
 * Primitives are; a struct, an enum or a tuple is when everything in it is; an extern type is when
 * it is declared `sendable` and its type arguments are; a shared struct never is, since its values
 * have an identity (§3.18); a function type is when it is declared `sendable` (§3.14); a type
 * parameter is when constrained `is Sendable`, or by a trait that implies it (`Encodable`,
 * `Decodable`). A recursive type is sendable unless something in its cycle isn't, so a type being
 * decided counts as sendable while its own fields are. Conformance meets Sendable by this rule
 * (resolution/derived-traits.ts).
 *
 * Code is sendable only to another instance of the same program; whether a value can go to the
 * host is whether it has a codec (rules/json-forms/), which no function type has. A host type a
 * `dispose` makes disposable has one, yet isn't sendable: its values have an identity.
 */

import { type WellKnownDeclaration, wellKnown } from '../../../language/well-known.ts';
import type { CheckerContext } from '../context.ts';
import { heldParts } from '../types/held.ts';
import type { NominalType, Type } from '../types/type.ts';
import { TypeCycle } from '../types/type-cycle.ts';
import { isWellKnownTrait } from '../types/well-known.ts';
import { knownConstraints } from './known-constraints.ts';

/**
 * The traits a type parameter may be constrained by to be sendable: Sendable, and those that
 * imply it, which require it of every type meeting them (resolution/derived-traits.ts).
 */
const sendableTraits: readonly WellKnownDeclaration[] = [
  wellKnown.sendable,
  wellKnown.encodable,
  wellKnown.decodable,
];

/** Whether values of `type` may leave an instance for another. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return sendable(checker, type, new TypeCycle(checker.typeKeys));
}

function sendable(checker: CheckerContext, type: Type, deciding: TypeCycle): boolean {
  switch (type.kind) {
    case 'primitive':
    case 'literal':
    case 'error':
      return true;
    case 'function':
      return type.isSendable;
    case 'tuple':
    case 'anonymous':
    case 'union':
      return heldParts(checker, type).every((child) => sendable(checker, child, deciding));
    case 'parameter':
    case 'associated':
    case 'field':
    case 'any':
      return knownConstraints(checker, type).some(({ trait }) =>
        sendableTraits.some((each) => isWellKnownTrait(checker, trait, each)),
      );
    case 'nominal':
      return nominalSendable(checker, type, deciding);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function nominalSendable(checker: CheckerContext, type: NominalType, deciding: TypeCycle): boolean {
  const { declaration } = type.entity;
  const parts = () => heldParts(checker, type).every((part) => sendable(checker, part, deciding));
  if (declaration.kind === 'ExternStructDeclaration') {
    return declaration.isSendable && parts();
  }
  if (declaration.kind === 'SharedStructDeclaration') {
    return false;
  }
  return deciding.enter(type, true, parts);
}
