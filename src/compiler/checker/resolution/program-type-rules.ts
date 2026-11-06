/**
 * The rules over types that need the program, as one checker gives them: normalizing types
 * (types/type-rules.ts: whether an `any` member of a union takes another member whole, what an
 * associated type, a field's type, a struct's keys or a mapped struct type of a known type reduce
 * to), and fitting a value to a type
 * (types/fitting/fit.ts), which adds conformance, the shapes of nominal structs and member parameters.
 *
 * An absorbing question is an entry of the checker's tables, keyed by both types' keys:
 * conformance may build the very union asking, so a question reached again while it is answered
 * takes `false`, the member kept beside the `any` one, alike whichever was asked first.
 *
 * An associated type asked for with nothing under way is an entry too, keyed by its owner's spelled
 * key, so what expanding it reads is logged like any entry's reads and an edit changing it is seen.
 * One under way expands as its expansion stands (traits/known-constraints.ts), never kept. Reached
 * again while it expands, it is the error type, as an alias reached again is.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { withEmptied } from '../../../structures/stack.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { associatedTypeOf, type Expansion } from '../traits/known-constraints.ts';
import { fieldTypeOf, isKeyWithin, keysOf, mappedTypeOf } from '../traits/struct-keys.ts';
import { unfolded } from '../types/computed-types.ts';
import type { Fitting } from '../types/fitting/fit.ts';
import { typeKeys } from '../types/identity/type-keys.ts';
import { sameTypeSpelled } from '../types/parts/type-parts.ts';
import { errorType } from '../types/primitives.ts';
import type { AnonymousStructType, AnyType, Type } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { meetsAny } from './trait-objects.ts';
import { TypeMatchReductions } from './type-matches.ts';

/** An associated type asked for: its owner and its name. */
interface Associated {
  readonly of: Type;
  readonly name: string;
}

/** An `any` member of a union, and another member it may take whole. */
interface Absorbing {
  readonly target: AnyType;
  readonly member: Type;
}

/** The type rules and the fitting of `checker`'s program. */
export interface ProgramTypeRules {
  readonly typeRules: TypeRules;
  readonly fitting: Fitting;
}

/** What the program's rules read of its declarations: struct layouts. */
export interface TypeRuleSeams {
  /** A nominal struct's shape, which its layouts know. */
  readonly layouts: { readonly nominalShapeOf: (type: Type) => AnonymousStructType | undefined };
}

/** The rules of `checker`'s program, its absorbing answers kept in its entries. */
export function programTypeRules(
  checker: CheckerContext,
  { layouts }: TypeRuleSeams,
): ProgramTypeRules {
  const absorbed: EntryTable<CheckerNote, string, boolean, Absorbing> = checker.entries.table({
    name: 'absorbed members',
    compute: (_key, { target, member }: Absorbing) => meetsAny(checker, member, target),
    cyclic: { standIn: () => false },
  });
  const reductions = new TypeMatchReductions(checker);
  // The associated types being expanded: what is under way, the only state.
  const associating: Expansion[] = [];
  const associatedTypes: EntryTable<CheckerNote, string, Type, Associated> = checker.entries.table({
    name: 'associated types',
    compute: (_key, { of, name }: Associated) => associatedTypeOf(checker, of, name, associating),
    equal: sameTypeSpelled,
    cyclic: { standIn: () => errorType },
  });
  const typeRules: TypeRules = {
    absorbs: (target, member) =>
      absorbed.get(JSON.stringify([typeKeys.typeKey(target), typeKeys.typeKey(member)]), {
        target,
        member,
      }),
    associatedType: (of, name) =>
      associating.length === 0 && reductions.isIdle()
        ? associatedTypes.get(`${typeKeys.spelledKey(of)}.${name}`, { of, name })
        : associatedTypeOf(checker, of, name, associating),
    fieldType: (of, key) => fieldTypeOf(checker, unfolded(of), key),
    keysOf: (of, without) => keysOf(checker, unfolded(of), without),
    mappedType: (parts, outer) => mappedTypeOf(checker, parts, outer),
    // A type `match` closes what its reduction reaches again into a recursive type (§3.17), so an
    // associated type expanded around it, reached inside, is no cycle of expansions.
    matchType: (declaration, typeArguments) =>
      withEmptied(associating, () => reductions.reduce(declaration, typeArguments)),
    isKeyOf: (key, of) => isKeyWithin(checker, key, checker.typeRules.keysOf(of, [])),
  };
  const fitting: Fitting = {
    ...typeRules,
    meetsAny: (type, target) => meetsAny(checker, type, target),
    shapeOf: (type) => layouts.nominalShapeOf(type),
    memberUnionOf: ({ declaration, within }) =>
      within ??
      (declaration.kind === 'TypeParameter' ? checker.memberUnionOf(declaration) : undefined),
  };
  return { typeRules, fitting };
}
