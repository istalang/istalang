/**
 * What a value of a type holds at any depth, for rules about values held inside others: a future
 * that must be awaited (§3.3), a `Result` that must be used (§3.12). A type holds itself, its
 * type arguments, its tuple elements and an anonymous struct's fields; a declared struct's fields
 * are its declaration's business, checked where it is declared.
 */

import type { CheckerContext } from '../context.ts';
import { type Type, typeChildren } from './type.ts';

/** The first type `type` holds, itself first, that `picks` picks; undefined when none is. */
export function heldType(type: Type, picks: (type: Type) => boolean): Type | undefined {
  if (picks(type)) {
    return type;
  }
  return partsOf(type)
    .map((part) => heldType(part, picks))
    .find((held) => held !== undefined);
}

function partsOf(type: Type): readonly Type[] {
  switch (type.kind) {
    case 'nominal':
      return type.arguments;
    case 'tuple':
      return type.elements;
    case 'anonymous':
      return type.fields.map((field) => field.type);
    default:
      return [];
  }
}

/**
 * What a value of `type` holds one level down: a tuple's elements, a struct's fields, the fields of
 * each of an enum's variants, and an extern type's type arguments, which stand for the values the
 * runtime or the host keeps in it.
 */
export function heldParts(
  checker: Pick<CheckerContext, 'fieldsOf' | 'variantsOf'>,
  type: Type,
): readonly Type[] {
  switch (type.kind) {
    case 'tuple':
    case 'anonymous':
      return typeChildren(type);
    case 'nominal':
      switch (type.entity.declaration.kind) {
        case 'ExternStructDeclaration':
          return type.arguments;
        case 'StructDeclaration':
          return (checker.fieldsOf(type) ?? []).map((field) => field.type);
        default:
          return (checker.variantsOf(type) ?? []).flatMap(({ fields }) =>
            fields.map((field) => field.type),
          );
      }
    default:
      return [];
  }
}
