/**
 * Constraints (§3.5, §3.10): the traits after `is` on a type parameter, and what each requires.
 *
 * - A constraint names a trait, with its type arguments resolved and defaults filled, where `Self`
 *   stands for the constrained parameter: `T is Addable` is `Addable<T>`.
 * - A requirement is one function of a constraint's trait, with the trait's parameters and its
 *   `Self` mapped for that constraint. Requirements are numbered by constraint and by the trait's
 *   order of functions (`RequirementOrigin`), which is how a call to one and the witness that
 *   satisfies it find each other per instantiation.
 */

import type { ModuleId } from '../../program/program.ts';
import type {
  FunctionDeclaration,
  TraitDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import { lastName } from '../../syntax/node.ts';
import type { FieldDeclaration, TypeNode } from '../../syntax/types.ts';
import type { RequirementOrigin } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { parameterType, typeArgumentsFor, typeParametersOf } from '../types/resolve-type.ts';
import { type ParameterKey, type Substitution, substitute, type Type } from '../types/type.ts';

/** A trait a type must satisfy, with its type arguments; `Self` already the constrained type. */
export interface Constraint {
  readonly trait: TraitDeclaration;
  readonly arguments: readonly Type[];
}

/** A function a constraint requires, and how its trait's parameters and `Self` map. */
export interface Requirement {
  readonly declaration: FunctionDeclaration;
  readonly origin: RequirementOrigin;
  readonly substitution: Substitution;
}

/** The constraints on `parameter`, resolved in `module`, where it is declared. */
export function resolveConstraints(
  checker: CheckerContext,
  module: ModuleId,
  parameter: TypeParameter,
): readonly Constraint[] {
  return parameter.constraints.flatMap((node) => {
    const constraint = resolveConstraint(checker, module, node, parameterType(parameter));
    return constraint === undefined ? [] : [constraint];
  });
}

/** The trait `node` names, with its arguments for a constrained type `self`; undefined after a report. */
function resolveConstraint(
  checker: CheckerContext,
  module: ModuleId,
  node: TypeNode,
  self: Type,
): Constraint | undefined {
  if (node.kind !== 'NamedType') {
    checker.report(module, checkerDiagnostics.notTrait(node.span));
    return undefined;
  }
  const entity = checker.bindings.entityOf(module, lastName(node.path));
  if (entity === undefined) {
    return undefined;
  }
  if (entity.kind !== 'type' || entity.declaration.kind !== 'TraitDeclaration') {
    checker.report(module, checkerDiagnostics.notTrait(node.span));
    return undefined;
  }
  const trait = entity.declaration;
  const written = node.typeArguments.map((argument) => checker.resolveType(module, argument));
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

/** How a constraint maps its trait's parameters, and `Self` to `constrained`. */
export function constraintSubstitution(constraint: Constraint, constrained: Type): Substitution {
  const substitution = new Map<ParameterKey, Type>([[constraint.trait, constrained]]);
  typeParametersOf(constraint.trait.typeParameters).forEach((parameter, index) => {
    const argument = constraint.arguments[index];
    if (argument !== undefined) {
      substitution.set(parameter, argument);
    }
  });
  return substitution;
}

/** Every function the constraints on `parameter` require, named `name`. */
export function requirementsNamed(
  checker: CheckerContext,
  parameter: TypeParameter,
  name: string,
): readonly Requirement[] {
  return checker.constraintsOf(parameter).flatMap((constraint, constraintIndex) => {
    const substitution = constraintSubstitution(constraint, parameterType(parameter));
    return requiredFunctions(constraint.trait).flatMap((declaration, member) =>
      declaration.name.text === name
        ? [
            {
              declaration,
              substitution,
              origin: { parameter, constraint: constraintIndex, member },
            },
          ]
        : [],
    );
  });
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
  );
}
