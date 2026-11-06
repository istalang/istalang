/**
 * What a value of a type holds at any depth, for rules about values held inside others: a future
 * that must be awaited (§3.3), a `Result` that must be used (§3.12). A type holds itself and what
 * its parts hold: a tuple's elements, a struct's fields, an enum's variants' fields, the value
 * behind a shared struct, and an extern type's type arguments (`heldParts`). A recursive type holds
 * nothing more where it recurs (type-cycle.ts).
 */

import type { CheckerContext } from '../../context.ts';
import { unfolded } from '../computed-types.ts';
import { typeChildren } from '../parts/type-children.ts';
import type { Type } from '../type/index.ts';
import { TypeCycle } from './type-cycle.ts';

/** The first type `type` holds, itself first, that `picks` picks; undefined when none is. */
export function heldType(
  checker: Pick<
    CheckerContext,
    'fieldsOf' | 'variantsOf' | 'sharedValueOf' | 'typeKeys' | 'typeRules'
  >,
  type: Type,
  picks: (type: Type) => boolean,
): Type | undefined {
  const cycle = new TypeCycle(checker.typeKeys);
  const held = (part: Type): Type | undefined =>
    picks(part)
      ? part
      : cycle.enter(part, undefined, (): Type | undefined => {
          for (const inner of heldParts(checker, part)) {
            const found = held(inner);
            if (found !== undefined) {
              return found;
            }
          }
          return undefined;
        });
  return held(type);
}

/**
 * What a value of `type` holds one level down: a tuple's elements, a struct's fields, the fields of
 * each of an enum's variants, what a handle's cell holds, and an extern type's type arguments,
 * which stand for the values the runtime or the host keeps in it.
 */
export function heldParts(
  checker: Pick<CheckerContext, 'fieldsOf' | 'variantsOf' | 'sharedValueOf' | 'typeRules'>,
  type: Type,
): readonly Type[] {
  switch (type.kind) {
    case 'recursive':
      return heldParts(checker, unfolded(type));
    case 'tuple':
    case 'anonymous':
    case 'union':
      return typeChildren(type);
    case 'nominal':
      switch (type.entity.declaration.kind) {
        case 'ExternStructDeclaration':
          return type.arguments;
        case 'StructDeclaration':
          return (checker.fieldsOf(type) ?? []).map((field) => field.type);
        case 'SharedStructDeclaration':
          return (checker.sharedValueOf(type)?.fields ?? []).map((field) => field.type);
        case 'EnumDeclaration':
          return (checker.variantsOf(type) ?? []).flatMap(({ fields }) =>
            fields.map((field) => field.type),
          );
        default: {
          const unhandled: never = type.entity.declaration;
          return unhandled;
        }
      }
    case 'mapped':
      return [...type.named.map((field) => field.type), type.value];
    case 'primitive':
    case 'literal':
    case 'function':
    case 'parameter':
    case 'associated':
    case 'field':
    case 'keys':
    case 'match':
    case 'any':
    case 'error':
      return [];
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
