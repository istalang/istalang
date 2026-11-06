/**
 * Constraints (§3.5, §3.10): the traits after `is` on a type parameter or after `any`, and what
 * each requires.
 *
 * - A constraint names a trait, with its type arguments resolved and defaults filled, where `Self`
 *   stands for the constrained parameter: `T is Addable` is `Addable<T>`. After `any`, `Self` stays
 *   the trait's own, standing for each value's type: `any Iterable<Int>` is `Iterable<Int, Self>`.
 * - A requirement is one function of a constraint's trait, with the trait's parameters and its
 *   `Self` mapped for that constraint. Requirements are numbered by constraint and by the trait's
 *   order of functions (`RequirementOrigin`), which is how a call to one and the witness that
 *   satisfies it find each other per instantiation.
 * - What a type meets by what it is, its fields and requirements included, is
 *   known-constraints.ts's; struct constraints (§3.5) are resolved in struct-constraints.ts.
 */

import type { WellKnownDeclaration } from '../../../language/well-known/index.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  FunctionDeclaration,
  RequiredAssociatedType,
  TraitDeclaration,
  TypeParameter,
} from '../../syntax/declarations/index.ts';
import { lastName } from '../../syntax/node.ts';
import {
  type FieldDeclaration,
  type TypeNode,
  unparenthesizedType,
} from '../../syntax/types/index.ts';
import type { CheckerContext } from '../contexts/context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { RequirementOrigin } from '../surface/resolved-call.ts';
import { sameType } from '../types/identity/identity.ts';
import {
  type Substitution,
  substitute,
  substituteConstraint,
  substitutionFor,
} from '../types/substitution.ts';
import type { AnyType, Constraint, ParameterKey, Type } from '../types/type/index.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { parameterType } from '../types/written/resolve-type.ts';
import { typeArgumentsFor } from '../types/written/type-arguments.ts';

/** The well-known trait `declaration` names, as a constraint with no type arguments. */
export function wellKnownConstraint(
  checker: CheckerContext,
  declaration: WellKnownDeclaration,
): Constraint {
  const entity = checker.wellKnownEntity(declaration);
  if (entity?.kind !== 'type' || entity.declaration.kind !== 'TraitDeclaration') {
    unreachable(`The ${declaration.module} module declares no trait '${declaration.name}'.`);
  }
  return { trait: entity.declaration, arguments: [] };
}

/**
 * A function a constraint requires, and how its trait's parameters and `Self` map. A call on a
 * union through a trait nothing names its arguments for (union-traits.ts) leaves the trait's
 * parameters without a default `inferred`: unmapped, found from the call's arguments as the
 * function's own type parameters are (resolution/choosing/choice.ts), then closed
 * (applied-call.ts).
 */
export interface Requirement {
  readonly declaration: FunctionDeclaration;
  readonly origin: RequirementOrigin;
  readonly substitution: Substitution;
  readonly inferred?: readonly TypeParameter[] | undefined;
}

/**
 * The constraints after `any`, each trait's `Self` its own (§3.10), their type arguments resolved
 * by `argumentType`; undefined for one reported.
 */
export function resolveAnyConstraints(
  checker: CheckerContext,
  module: ModuleId,
  nodes: readonly TypeNode[],
  argumentType: (argument: TypeNode) => Type,
): readonly (Constraint | undefined)[] {
  return nodes.map((node) =>
    resolveConstraint(checker, module, node, {
      keyword: 'any',
      selfOf: parameterType,
      argumentType,
    }),
  );
}

/**
 * Where a constraint is written: after which keyword, what its trait's `Self` stands for, and how
 * its written type arguments resolve there: as the checker resolves type nodes, unless a closing
 * body's resolution (types/written/resolve-type.ts) gives its own.
 */
export interface ConstraintSite {
  readonly keyword: 'is' | 'any';
  readonly selfOf: (trait: TraitDeclaration) => Type;
  readonly argumentType?: (argument: TypeNode) => Type;
}

/**
 * The trait `constraint` names, parentheses aside, with its arguments for `Self`; undefined after a
 * report.
 */
export function resolveConstraint(
  checker: CheckerContext,
  module: ModuleId,
  constraint: TypeNode,
  {
    keyword,
    selfOf,
    argumentType = (argument: TypeNode): Type => checker.resolveType(module, argument),
  }: ConstraintSite,
): Constraint | undefined {
  const node = unparenthesizedType(constraint);
  if (node.kind !== 'NamedType') {
    checker.report(module, checkerDiagnostics.notTrait(node.span, keyword));
    return undefined;
  }
  const entity = checker.bindings.entityOf(module, lastName(node.path));
  if (entity === undefined) {
    return undefined;
  }
  if (entity.kind !== 'type' || entity.declaration.kind !== 'TraitDeclaration') {
    checker.report(module, checkerDiagnostics.notTrait(node.span, keyword));
    return undefined;
  }
  const trait = entity.declaration;
  const self = selfOf(trait);
  const written = node.typeArguments.map(argumentType);
  const typeArguments = typeArgumentsFor(checker, module, {
    at: node.span,
    declaration: trait,
    types: written,
    self,
  });
  return typeArguments === undefined ? undefined : { trait, arguments: typeArguments };
}

/** The functions a trait requires, in its order. */
export function requiredFunctions(trait: TraitDeclaration): readonly FunctionDeclaration[] {
  return trait.members.filter((member) => member.kind === 'FunctionDeclaration');
}

/** The fields a trait requires (§3.10). */
export function requiredFields(trait: TraitDeclaration): readonly FieldDeclaration[] {
  return trait.members.filter((member) => member.kind === 'FieldDeclaration');
}

/** The associated types a trait requires (§3.10). */
export function requiredAssociatedTypes(
  trait: TraitDeclaration,
): readonly RequiredAssociatedType[] {
  return trait.members.filter((member) => member.kind === 'RequiredAssociatedType');
}

/**
 * `constraint`, met by `on`, as `any` takes it (§3.10): an argument that is `on` itself is the
 * trait's own `Self`, so each type `on` may become reads it alike.
 */
export function traitAsAny(constraint: Constraint, on: Type): AnyType {
  const self = parameterType(constraint.trait);
  const typeArguments = constraint.arguments.map((each) => (sameType(each, on) ? self : each));
  return { kind: 'any', constraints: [{ trait: constraint.trait, arguments: typeArguments }] };
}

/** How a constraint maps its trait's parameters, and `Self` to `constrained`. */
export function constraintSubstitution(constraint: Constraint, constrained: Type): Substitution {
  return new Map<ParameterKey, Type>([
    [constraint.trait, constrained],
    ...substitutionFor(constraint.trait.typeParameters, constraint.arguments),
  ]);
}

/** `constraint` of an `any` type as met by `type`: its trait's own `Self` replaced by `type`. */
export function constraintOn(constraint: Constraint, type: Type, rules: TypeRules): Constraint {
  return substituteConstraint(constraint, new Map([[constraint.trait, type]]), rules);
}

/** The type `constraint` requires its trait's `field` to have, for the type `constrained`. */
export function requiredFieldType(
  checker: CheckerContext,
  constraint: Constraint,
  field: FieldDeclaration,
  constrained: Type,
): Type {
  return substitute(
    checker.resolveType(checker.moduleOf(constraint.trait), field.type),
    constraintSubstitution(constraint, constrained),
    checker.typeRules,
  );
}
