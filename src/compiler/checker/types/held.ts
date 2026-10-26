/**
 * What a value of a type holds at any depth, for rules about values held inside others: a future
 * that must be awaited (§3.3), a `Result` that must be used (§3.12). A type holds itself and what
 * its parts hold: a tuple's elements, a struct's fields, an enum's variants' fields, the value
 * behind a shared struct, and an extern type's type arguments (`heldParts`). A recursive type is walked once.
 */

import type { CheckerContext } from '../context.ts';
import { type Type, typeChildren } from './type.ts';

/** The first type `type` holds, itself first, that `picks` picks; undefined when none is. */
export function heldType(
  checker: Pick<CheckerContext, 'fieldsOf' | 'variantsOf' | 'sharedValueOf' | 'typeKeys'>,
  type: Type,
  picks: (type: Type) => boolean,
): Type | undefined {
  const walked = new Set<string>();
  const held = (part: Type): Type | undefined => {
    if (picks(part)) {
      return part;
    }
    if (part.kind === 'nominal') {
      const key = checker.typeKeys.typeKey(part);
      if (walked.has(key)) {
        return undefined;
      }
      walked.add(key);
    }
    for (const inner of heldParts(checker, part)) {
      const found = held(inner);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  return held(type);
}

/**
 * What a value of `type` holds one level down: a tuple's elements, a struct's fields, the fields of
 * each of an enum's variants, what a handle's cell holds, and an extern type's type arguments,
 * which stand for the values the runtime or the host keeps in it.
 */
export function heldParts(
  checker: Pick<CheckerContext, 'fieldsOf' | 'variantsOf' | 'sharedValueOf'>,
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
        case 'StructDeclaration': {
          const fields = checker.fieldsOf(type) ?? checker.sharedValueOf(type)?.fields ?? [];
          return fields.map((field) => field.type);
        }
        default:
          return (checker.variantsOf(type) ?? []).flatMap(({ fields }) =>
            fields.map((field) => field.type),
          );
      }
    default:
      return [];
  }
}
