/**
 * A type `match` (§3.17), resolved: what an alias or associated type whose body is one matches, and
 * how a use of one is told from a use of any other alias.
 *
 * - The subject and each case's pattern resolve once, with the declaration's own parameters open,
 *   and a case's type resolves apart, so deciding which case matches never needs a case's type: a
 *   case's type may use the alias itself, which a use reduces only once the alias is chosen.
 * - Inside a type `match`, a use of a type `match` alias stays unreduced as written (`MatchType`):
 *   its arguments are known only once a use substitutes them, which then reduces it.
 * - An `infer` variable is a type parameter, keyed by its node like any other, with the constraints
 *   it must meet for its case to match.
 */

import type {
  AliasDeclaration,
  AssociatedType,
  TypeAliasDeclaration,
  TypeParameter,
  TypeParameters,
} from '../../syntax/declarations.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree.ts';
import type { TypeCase } from '../../syntax/types.ts';
import type { RecursiveLabel } from './alias-uses.ts';
import type { MatchType } from './computed-types.ts';
import type { ConstraintSet, StructConstraintModel } from './struct-constraint.ts';
import { type Substitution, substitute } from './substitution.ts';
import { type NominalEntity, nominalType, type Type } from './type.ts';
import { mapChildren } from './type-parts.ts';
import type { TypeRules } from './type-rules.ts';

/** A type `match`'s subject and cases, its declaration's parameters open. */
export interface TypeMatchForm {
  /** What a use gives arguments for: the alias's own, or its declaration's for an associated type. */
  readonly parameters: TypeParameters;
  readonly subject: Type;
  /**
   * The parameter the subject is written as, if any: when a union distributes, it stands for the
   * member being matched inside a case (§3.17).
   */
  readonly subjectParameter: TypeParameter | undefined;
  readonly cases: readonly CaseForm[];
}

/** A case: what it matches, and the `infer` variables its pattern binds. */
export interface CaseForm {
  readonly node: TypeCase;
  readonly pattern: CasePatternForm;
  readonly variables: readonly InferVariable[];
}

/** What a case matches: any type (`_`), a type's form, or a struct meeting a struct constraint. */
export type CasePatternForm =
  | { readonly kind: 'any' }
  | { readonly kind: 'type'; readonly type: Type }
  | { readonly kind: 'struct'; readonly constraint: StructConstraintModel };

/** An `infer T is C` variable: the type parameter it is, and what the part it binds must meet. */
export interface InferVariable {
  readonly parameter: TypeParameter;
  readonly constraints: ConstraintSet;
}

/** What a checker answers of the type `match`es its aliases have (declarations/aliases.ts). */
export interface TypeMatchQueries {
  /** The subject and cases of `alias`'s type `match`; undefined when its body is a type. */
  readonly typeMatchOf: (alias: AliasDeclaration) => TypeMatchForm | undefined;
  /** The type the case `node` of `alias`'s type `match` gives, its variables open. */
  readonly caseTypeOf: (alias: AliasDeclaration, node: TypeCase) => Type;
  /**
   * Whether `alias`'s reductions never end (§3.5), reaching itself with a type built from its own
   * parameters: reported once, at the alias.
   */
  readonly isEndless: (alias: AliasDeclaration) => boolean;
  /**
   * The unreduced use of `alias` given `typeArguments`: an associated type's carrying the type
   * that declares it, which it reads through (`matchUse`).
   */
  readonly useOf: (alias: AliasDeclaration, typeArguments: readonly Type[]) => MatchType;
}

/**
 * The unreduced use of `declaration`, whose body is a type `match`, with `typeArguments`: an
 * alias's, or an associated type's of `owner`, the type declaring it, which the use reads through
 * (`Bad<Int>.Data`, type-text.ts); undefined only where that type names none.
 */
export function matchUse(
  declaration: TypeAliasDeclaration,
  typeArguments: readonly Type[],
): MatchType;
export function matchUse(
  declaration: AssociatedType,
  typeArguments: readonly Type[],
  owner: NominalEntity | undefined,
): MatchType;
export function matchUse(
  declaration: AliasDeclaration,
  typeArguments: readonly Type[],
  owner?: NominalEntity,
): MatchType {
  return { kind: 'match', declaration, arguments: typeArguments, owner };
}

/** How the use `use` reads as a recursive type's label: its alias, or its owner's associated type. */
export function labelOf(use: MatchType): RecursiveLabel | undefined {
  const { declaration, arguments: typeArguments, owner } = use;
  if (declaration.kind === 'TypeAliasDeclaration') {
    return { kind: 'alias', declaration, arguments: typeArguments };
  }
  return owner === undefined
    ? undefined
    : { kind: 'associated', of: nominalType(owner, typeArguments), name: declaration.name.text };
}

/**
 * The type `declaration` stands for, `aliased` with its parameters open, with `substitution`
 * giving them: a type `match` reduced for what they are given (§3.17), any other type substituted
 * (§3.1, §3.17).
 */
export function aliasInstance(
  declaration: AliasDeclaration,
  aliased: Type,
  substitution: Substitution,
  rules: TypeRules,
): Type {
  if (aliased.kind === 'match' && aliased.declaration === declaration) {
    const given = aliased.arguments.map((each) => substitute(each, substitution, rules));
    return rules.matchType(declaration, given);
  }
  return substitute(aliased, substitution, rules);
}

/**
 * The case of a type `match` whose type `node` stands in, when its pattern is a struct constraint,
 * with its type `match` and the alias it is the body of (§3.17); else undefined.
 */
export function structCaseOf(
  tree: SyntaxTree,
  node: SyntaxNode,
): { readonly node: TypeCase; readonly alias: AliasDeclaration } | undefined {
  let child = node;
  for (let parent = parentOf(tree, node); parent !== undefined; parent = parentOf(tree, parent)) {
    if (parent.kind === 'TypeCase') {
      const alias = parentOf(tree, parentOf(tree, parent) ?? parent);
      const isStructCase = child === parent.type && parent.pattern.kind === 'StructConstraint';
      return isStructCase &&
        (alias?.kind === 'TypeAliasDeclaration' || alias?.kind === 'AssociatedType')
        ? { node: parent, alias }
        : undefined;
    }
    child = parent;
  }
  return undefined;
}

/**
 * `type` built again by `rules` at every level, each type in it computed from others reduced as far
 * as its parts allow: what a case's type, resolved with the uses in it unreduced, becomes once a use
 * of its alias picks it.
 */
export function rebuilt(type: Type, rules: TypeRules): Type {
  return mapChildren(type, (child) => rebuilt(child, rules), rules);
}
