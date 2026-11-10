/**
 * The rules over types that need the program, as one checker gives them: normalizing types
 * (types/type/type-rules.ts: whether an `any` member of a union takes another member whole, what an
 * associated type, a field's type, a struct's keys or a mapped struct type of a known type reduce
 * to), and fitting a value to a type (types/fitting/fit/index.ts), which adds conformance, the
 * shapes of nominal structs and member parameters.
 *
 * An absorbing question is an entry of the checker's tables, keyed by both types' keys:
 * conformance may build the very union asking, so a question reached again while it is answered
 * takes `false`, the member kept beside the `any` one, alike whichever was asked first.
 *
 * An associated type asked for with nothing under way is an entry too, keyed by its owner's spelled
 * key, so what expanding it reads is logged like any entry's reads and an edit changing it is seen.
 * One under way expands as its expansion stands (types/traits/known-constraints.ts), never kept.
 * Reached again while it expands, it is the error type, as an alias reached again is.
 *
 * The instantiation a type meets in an `any` constraint's place, and those a type may meet, are
 * entries too, keyed by the type's spelling and the constraint's or the trait's: fitting, dispatch
 * and reports ask the first, inference the second, at every conversion into an `any` type.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../foundation/structures/equality.ts';
import { withEmptied } from '../../../../foundation/structures/stack.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import {
  instantiationsOf,
  proposedInstantiations,
  searchMetInstantiation,
} from '../../resolution/conformance/met-instantiations/index.ts';
import { absorbs, meetsAny } from '../../resolution/conformance/trait-objects.ts';
import { goalKey } from '../../resolution/conformance/witness-outcomes.ts';
import { TypeMatchReductions } from '../../resolution/type-matches/type-matches.ts';
import type { Fitting } from '../../types/fitting/fit/index.ts';
import type {
  MetInstantiation,
  ProposedInstantiation,
} from '../../types/fitting/met-instantiation.ts';
import { sameConstraint, sameType } from '../../types/identity/identity.ts';
import { typeKeys } from '../../types/identity/type-keys.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import {
  declaredFieldType,
  requiredFields,
  requiredFunctions,
  requirementType,
} from '../../types/traits/constraints.ts';
import { associatedTypeOf, type Expansion } from '../../types/traits/known-constraints.ts';
import { fieldTypeOf, isKeyWithin, keysOf, mappedTypeOf } from '../../types/traits/struct-keys.ts';
import { unfolded } from '../../types/type/computed-types.ts';
import { functionType } from '../../types/type/function-types.ts';
import type { AnonymousStructType, AnyType, Constraint, Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import type { TypeRules } from '../../types/type/type-rules.ts';
import { futuresOf } from '../../types/type/well-known.ts';
import type { Variance } from '../../types/variance/lattice.ts';
import {
  type DerivedDeclaration,
  type HeldPart,
  type VariedDeclaration,
  varianceOf,
} from '../../types/variance/variance.ts';

/** An associated type asked for: its owner and its name. */
interface Associated {
  readonly of: Type;
  readonly name: string;
}

/** A type and a constraint whose trait's instantiation it meets in its place is sought. */
interface Sought {
  readonly found: Type;
  readonly constraint: Constraint;
}

/** A type, and a trait whose instantiations it may meet are proposed. */
interface Proposing {
  readonly type: Type;
  readonly trait: TraitDeclaration;
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
    compute: (_key, { target, member }: Absorbing) => absorbs(checker, member, target),
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
  const futures = futuresOf(checker);
  const variances: EntryTable<CheckerNote, VariedDeclaration, readonly Variance[]> =
    checker.entries.table({
      name: 'variances',
      compute: (declaration) =>
        varianceOf(declaration, {
          partsOf: (held) => partsOf(checker, held),
          awaitedOf: futures.awaitedOf,
        }),
      equal: sameItems(),
    });
  const fitting: Fitting = {
    ...typeRules,
    varianceOf: (declaration) => variances.get(declaration),
    meetsAny: (type, target) => meetsAny(checker, type, target),
    ...instantiationsIn(checker),
    shapeOf: (type) => layouts.nominalShapeOf(type),
    ...futures,
    memberUnionOf: ({ declaration, within }) =>
      within ??
      (declaration.kind === 'TypeParameter' ? checker.memberUnionOf(declaration) : undefined),
  };
  return { typeRules, fitting };
}

/**
 * The answers of the one search for the instantiations a type meets (`Fitting.metInstantiation`,
 * `Fitting.proposedInstantiations`), kept in `checker`'s entries: fitting, dispatch and a misfit's
 * report ask the first at every conversion into an `any` type, inference the second at every one
 * it relates. A search reached again while it runs searches afresh, as a root goal does.
 */
function instantiationsIn(
  checker: CheckerContext,
): Pick<Fitting, 'metInstantiation' | 'proposedInstantiations'> {
  const met: EntryTable<CheckerNote, string, MetInstantiation, Sought> = checker.entries.table({
    name: 'met instantiations',
    compute: (_key, { found, constraint }: Sought) =>
      searchMetInstantiation(checker, found, constraint),
    equal: sameMet,
  });
  const proposed: EntryTable<CheckerNote, string, readonly ProposedInstantiation[], Proposing> =
    checker.entries.table({
      name: 'proposed instantiations',
      compute: (_key, { type, trait }: Proposing) => instantiationsOf(checker, type, trait),
      equal: sameItems(sameProposed),
    });
  const { typeKeys: keys } = checker;
  return {
    metInstantiation: (found, constraint) => {
      const key = goalKey(keys, found, constraint, (each) => keys.spelledKey(each));
      return met.running(key)
        ? searchMetInstantiation(checker, found, constraint)
        : met.get(key, { found, constraint });
    },
    proposedInstantiations: (found, trait) =>
      proposedInstantiations(checker, { found, trait }, (type) => {
        const key = `${keys.spelledKey(type)} ${keys.identityOf(trait)}`;
        return proposed.running(key)
          ? instantiationsOf(checker, type, trait)
          : proposed.get(key, { type, trait });
      }),
  };
}

/** Whether two instantiations proposed are one. */
function sameProposed(first: ProposedInstantiation, second: ProposedInstantiation): boolean {
  return sameType(first.self, second.self) && sameConstraint(first.constraint, second.constraint);
}

/** Whether two answers of the search are one. */
function sameMet(first: MetInstantiation, second: MetInstantiation): boolean {
  switch (first.kind) {
    case 'met':
      return second.kind === 'met' && sameConstraint(first.constraint, second.constraint);
    case 'several':
      return second.kind === 'several' && sameItems(sameConstraint)(first.fitting, second.fitting);
    default:
      return second.kind === first.kind;
  }
}

/**
 * What `declaration`'s values hold (§3.5): a struct's fields, every variant's fields, the type an
 * alias names; a trait's requirements, each as the function type a call through `any` makes, its
 * receiver apart and exact, and its required fields, which an `any` value gives (§3.10).
 */
function partsOf(
  checker: Pick<
    CheckerContext,
    | 'declaredFieldsOf'
    | 'declaredVariantsOf'
    | 'aliasedType'
    | 'parametersOf'
    | 'resultOf'
    | 'resolveType'
    | 'moduleOf'
    | 'kindOf'
    | 'wellKnownType'
  >,
  declaration: DerivedDeclaration,
): readonly HeldPart[] {
  const given = (type: Type): HeldPart => ({ type, at: 'covariant' });
  if (declaration.kind === 'TypeAliasDeclaration') {
    return [given(checker.aliasedType(declaration))];
  }
  if (declaration.kind === 'TraitDeclaration') {
    const requirements = requiredFunctions(declaration).flatMap((required): HeldPart[] => {
      const type = requirementType(checker, required);
      // A static requirement has no receiver; object safety keeps it from any `any` type.
      const [receiver, ...taken] = required.owner === undefined ? type.parameters : [];
      return receiver === undefined
        ? [given(type)]
        : [
            given(functionType({ ...type, parameters: taken })),
            { type: receiver.type, at: 'invariant' },
          ];
    });
    const fields = requiredFields(declaration).map((field) =>
      given(declaredFieldType(checker, declaration, field)),
    );
    return [...requirements, ...fields];
  }
  const fields =
    declaration.kind === 'StructDeclaration'
      ? checker.declaredFieldsOf(declaration)
      : checker.declaredVariantsOf(declaration).flatMap((variant) => variant.fields);
  return fields.map((field) => given(field.type));
}
