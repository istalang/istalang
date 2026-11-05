/**
 * The rules over types that need the program, as one checker gives them: normalizing types
 * (types/type-rules.ts: whether an `any` member of a union takes another member whole, what an
 * associated type, a field's type, a struct's keys or a mapped struct type of a known type reduce
 * to), and fitting a value to a type
 * (types/fit.ts), which adds conformance, the shapes of nominal structs and member parameters.
 *
 * An absorbing question is an entry of the checker's tables, keyed by both types' keys:
 * conformance may build the very union asking, so a question reached again while it is answered
 * takes `false`, the member kept beside the `any` one, alike whichever was asked first.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { associatedTypeOf } from '../traits/known-constraints.ts';
import { fieldTypeOf, isKeyWithin, keysOf, mappedTypeOf } from '../traits/struct-keys.ts';
import { isMatchAlias } from '../types/computed-types.ts';
import type { Fitting } from '../types/fit.ts';
import type { AnonymousStructType, AnyType, Type } from '../types/type.ts';
import { typeKeys } from '../types/type-keys.ts';
import { unfolded } from '../types/type-match.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { meetsAny } from './trait-objects.ts';
import { TypeMatchReductions } from './type-matches.ts';

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

/** What the program's rules read of its declarations: struct layouts and aliases. */
export interface TypeRuleSeams {
  /** A nominal struct's shape, which its layouts know. */
  readonly layouts: { readonly nominalShapeOf: (type: Type) => AnonymousStructType | undefined };
  /** What a recursive use of an alias whose body is a type stands for, which its aliases know. */
  readonly aliases: Pick<TypeRules, 'unfold' | 'unfoldedMembers'>;
}

/** The rules of `checker`'s program, its absorbing answers kept in its entries. */
export function programTypeRules(
  checker: CheckerContext,
  { layouts, aliases }: TypeRuleSeams,
): ProgramTypeRules {
  const absorbed: EntryTable<CheckerNote, string, boolean, Absorbing> = checker.entries.table({
    name: 'absorbed members',
    compute: (_key, { target, member }: Absorbing) => meetsAny(checker, member, target),
    cyclic: { standIn: () => false },
  });
  const reductions = new TypeMatchReductions(checker);
  const typeRules: TypeRules = {
    absorbs: (target, member) =>
      absorbed.get(JSON.stringify([typeKeys.typeKey(target), typeKeys.typeKey(member)]), {
        target,
        member,
      }),
    associatedType: (of, name) => associatedTypeOf(checker, of, name),
    fieldType: (of, key) => fieldTypeOf(checker, unfolded(of, checker.typeRules), key),
    keysOf: (of, without) => keysOf(checker, unfolded(of, checker.typeRules), without),
    mappedType: (parts, outer) => mappedTypeOf(checker, parts, outer),
    matchType: (declaration, typeArguments) => reductions.reduce(declaration, typeArguments),
    unfold: (type) =>
      isMatchAlias(type.declaration) ? reductions.recursiveShape(type) : aliases.unfold(type),
    unfoldedMembers: (type) => aliases.unfoldedMembers(type),
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
