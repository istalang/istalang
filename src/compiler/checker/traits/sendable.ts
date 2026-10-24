/**
 * Which types are Sendable (§3.1): derived, never declared, except for extern types, which say so.
 *
 * Primitives are; a struct, an enum or a tuple is when everything in it is; an extern type is when
 * it is declared `sendable` and its type arguments are; a type parameter is only when constrained
 * `is Sendable`; a function type never is. A recursive type is sendable unless something in its
 * cycle isn't, so a type being decided counts as sendable while its own fields are.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { CheckerContext } from '../context.ts';
import { type NominalType, type Type, typeKey } from '../types/type.ts';

/** Whether values of `type` may leave an instance. */
export function isSendable(checker: CheckerContext, type: Type): boolean {
  return sendable(checker, type, new Set());
}

function sendable(checker: CheckerContext, type: Type, deciding: Set<string>): boolean {
  switch (type.kind) {
    case 'primitive':
    case 'error':
      return true;
    case 'function':
      return false;
    case 'tuple':
      return type.elements.every((element) => sendable(checker, element, deciding));
    case 'parameter':
      return (
        type.declaration.kind === 'TypeParameter' &&
        checker
          .constraintsOf(type.declaration)
          .some((constraint) => isSendableTrait(checker, constraint.trait))
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
  if (declaration.kind === 'ExternStructDeclaration') {
    return (
      declaration.isSendable &&
      type.arguments.every((argument) => sendable(checker, argument, deciding))
    );
  }
  const key = typeKey(type);
  if (deciding.has(key)) {
    return true;
  }
  deciding.add(key);
  const fields =
    declaration.kind === 'StructDeclaration'
      ? (checker.fieldsOf(type) ?? [])
      : (checker.variantsOf(type) ?? []).flatMap((variant) => variant.fields);
  const result = fields.every((field) => sendable(checker, field.type, deciding));
  deciding.delete(key);
  return result;
}

/** Whether `trait` is the prelude's Sendable. */
export function isSendableTrait(
  checker: CheckerContext,
  trait: { readonly name: { readonly text: string } },
): boolean {
  const sendableType = checker.wellKnownType(wellKnown.sendable);
  return sendableType?.kind === 'nominal'
    ? sendableType.entity.declaration === trait
    : trait.name.text === wellKnown.sendable.name;
}
