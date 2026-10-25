/**
 * Which types are Sendable (§3.1): derived, never declared, except for extern types, which say so.
 *
 * Primitives are; a struct, an enum or a tuple is when everything in it is; an extern type is when
 * it is declared `sendable` and its type arguments are; a type parameter is only when constrained
 * `is Sendable`. A function type is when it is declared `sendable` (§3.14), but code goes only to
 * another instance of the same program, never to the host, so where a value is sent decides that
 * one case. A recursive type is sendable unless something in its cycle isn't, so a type being
 * decided counts as sendable while its own fields are.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { TraitDeclaration } from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import { type NominalType, type Type, typeChildren } from '../types/type.ts';

/** Where a value leaving its instance goes: a new instance of the program (§9), or the host (§3.6). */
export type Destination = 'instance' | 'host';

/** Whether values of `type` may leave an instance for `destination`. */
export function isSendable(checker: CheckerContext, type: Type, destination: Destination): boolean {
  return sendable(checker, type, { destination, deciding: new Set() });
}

/** One sendability question: where values go, and the types being decided, which cycles reach. */
interface Asking {
  readonly destination: Destination;
  readonly deciding: Set<string>;
}

function sendable(checker: CheckerContext, type: Type, asking: Asking): boolean {
  switch (type.kind) {
    case 'primitive':
    case 'error':
      return true;
    case 'function':
      return type.isSendable && asking.destination === 'instance';
    case 'tuple':
    case 'anonymous':
      return typeChildren(type).every((child) => sendable(checker, child, asking));
    case 'parameter':
      return (
        type.declaration.kind === 'TypeParameter' &&
        checker
          .constraintsOf(type.declaration)
          .some((constraint) => isSendableTrait(checker, constraint.trait))
      );
    case 'nominal':
      return nominalSendable(checker, type, asking);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function nominalSendable(checker: CheckerContext, type: NominalType, asking: Asking): boolean {
  const { declaration } = type.entity;
  if (declaration.kind === 'ExternStructDeclaration') {
    return (
      declaration.isSendable &&
      type.arguments.every((argument) => sendable(checker, argument, asking))
    );
  }
  const { deciding } = asking;
  const key = checker.typeKeys.typeKey(type);
  if (deciding.has(key)) {
    return true;
  }
  deciding.add(key);
  const fields =
    declaration.kind === 'StructDeclaration'
      ? (checker.fieldsOf(type) ?? [])
      : (checker.variantsOf(type) ?? []).flatMap((variant) => variant.fields);
  const result = fields.every((field) => sendable(checker, field.type, asking));
  deciding.delete(key);
  return result;
}

/** Whether `trait` is the prelude's Sendable. */
export function isSendableTrait(checker: CheckerContext, trait: TraitDeclaration): boolean {
  const entity = checker.wellKnownEntity(wellKnown.sendable);
  return entity?.kind === 'type' && entity.declaration === trait;
}
