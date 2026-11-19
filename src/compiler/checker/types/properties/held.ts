/**
 * What a value of a type holds at any depth, for rules about values held inside others: whether it
 * may leave its instance (traits/sendability.ts), a future that must be awaited (§6.1), a `Result`
 * that must be used (§12). A type holds itself and what its parts hold: a tuple's elements, a
 * struct's fields, an enum's variants' fields, the value behind a shared struct, and what an extern
 * type's `@Holds` says, else its type arguments (`heldPartsOf`). A recursive type holds nothing more where it recurs
 * (type-cycle.ts).
 */

import type { CheckerContext } from '../../contexts/context.ts';
import { typeChildren } from '../parts/type-children.ts';
import { unfolded } from '../type/computed-types.ts';
import type { Type } from '../type/index.ts';
import { TypeCycle } from './type-cycle.ts';

type HeldReader = Pick<
  CheckerContext,
  'fieldsOf' | 'variantsOf' | 'sharedValueOf' | 'externHeldOf' | 'typeKeys' | 'typeRules'
>;

/** The first type `type` holds, itself first, that `picks` picks; undefined when none is. */
export function heldType(
  checker: HeldReader,
  type: Type,
  picks: (type: Type) => boolean,
): Type | undefined {
  let found: Type | undefined;
  walkHeld(checker, type, (part) => {
    found = picks(part) ? part : undefined;
    return found !== undefined;
  });
  return found;
}

/** Every type `type` holds at any depth, itself first, once along each path. */
export function heldTypes(checker: HeldReader, type: Type): readonly Type[] {
  const held: Type[] = [];
  walkHeld(checker, type, (part) => {
    held.push(part);
    return false;
  });
  return held;
}

/**
 * Visits each type `type` holds, itself first, until `visit` says to stop, which it then returns;
 * what a part holds is visited after the part.
 */
function walkHeld(checker: HeldReader, type: Type, visit: (part: Type) => boolean): boolean {
  const cycle = new TypeCycle(checker.typeKeys);
  const walk = (part: Type): boolean =>
    visit(part) ||
    cycle.enter(part, false, () => heldPartsOf(checker, part).some((inner) => walk(inner)));
  return walk(type);
}

/**
 * What a value of `type` holds one level down: a tuple's elements, a struct's fields, the fields of
 * each of an enum's variants, what a handle's cell holds, and what an extern type's `@Holds` names
 * (§5.5), else its type arguments, which stand for the values the runtime or the host keeps in it.
 */
export function heldPartsOf(
  checker: Pick<
    CheckerContext,
    'fieldsOf' | 'variantsOf' | 'sharedValueOf' | 'externHeldOf' | 'typeRules'
  >,
  type: Type,
): readonly Type[] {
  switch (type.kind) {
    case 'recursive':
      return heldPartsOf(checker, unfolded(type));
    case 'tuple':
    case 'anonymous':
    case 'union':
      return typeChildren(type);
    case 'nominal':
      switch (type.entity.declaration.kind) {
        case 'ExternStructDeclaration':
          return checker.externHeldOf(type);
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
