/**
 * Constraints (§3.5, §3.10): the traits after `is` on a type parameter or after `any`, and what each
 * requires.
 *
 * - A constraint names a trait, with its type arguments resolved and defaults filled, where `Self`
 *   stands for the constrained parameter: `T is Addable` is `Addable<T>`. After `any`, `Self` stays
 *   the trait's own, standing for each value's type: `any Iterable<Int>` is `Iterable<Int, Self>`.
 * - A requirement is one function of a constraint's trait, with the trait's parameters and its
 *   `Self` mapped for that constraint. Requirements are numbered by constraint and by the trait's
 *   order of functions (`RequirementOrigin`), which is how a call to one and the witness that
 *   satisfies it find each other per instantiation.
 * - A field of a type is a struct's, or, on a type parameter or an `any` type, one a constraint's
 *   trait requires (`fieldOf`): one rule for a field read, a field called and conformance.
 */

import type { WellKnownDeclaration } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  FunctionDeclaration,
  TraitDeclaration,
  TypeParameter,
} from '../../syntax/declarations.ts';
import { lastName } from '../../syntax/node.ts';
import { type FieldDeclaration, type TypeNode, unparenthesizedType } from '../../syntax/types.ts';
import { type FoundField, requiredFieldRead, structFieldOf } from '../checked-field.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { RequirementOrigin } from '../resolved-call.ts';
import { parameterType, typeArgumentsFor } from '../types/resolve-type.ts';
import { type Substitution, substitute, substitutionFor } from '../types/substitution.ts';
import type { AnyType, Constraint, ParameterKey, Type } from '../types/type.ts';

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
  const self = parameterType(parameter);
  return parameter.constraints.flatMap((node) => {
    const constraint = resolveConstraint(checker, module, node, {
      keyword: 'is',
      selfOf: () => self,
    });
    return constraint === undefined ? [] : [constraint];
  });
}

/** The constraints after `any`, each trait's `Self` its own (§3.10); undefined for one reported. */
export function resolveAnyConstraints(
  checker: CheckerContext,
  module: ModuleId,
  nodes: readonly TypeNode[],
): readonly (Constraint | undefined)[] {
  return nodes.map((node) =>
    resolveConstraint(checker, module, node, { keyword: 'any', selfOf: parameterType }),
  );
}

/** Where a constraint is written: after which keyword, and what its trait's `Self` stands for. */
interface ConstraintSite {
  readonly keyword: 'is' | 'any';
  readonly selfOf: (trait: TraitDeclaration) => Type;
}

/** The trait `constraint` names, parentheses aside, with its arguments for `Self`; undefined after a report. */
function resolveConstraint(
  checker: CheckerContext,
  module: ModuleId,
  constraint: TypeNode,
  { keyword, selfOf }: ConstraintSite,
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
  return new Map<ParameterKey, Type>([
    [constraint.trait, constrained],
    ...substitutionFor(constraint.trait.typeParameters, constraint.arguments),
  ]);
}

/**
 * Every function the constraints on `on` require, named `name`: on a type parameter, or on an
 * `any` type, where each is the function its value's own type meets it with (§3.10).
 */
export function requirementsNamed(
  checker: CheckerContext,
  on: TypeParameter | AnyType,
  name: string,
): readonly Requirement[] {
  const type = on.kind === 'any' ? on : parameterType(on);
  return knownConstraints(checker, type).flatMap((constraint, constraintIndex) => {
    const substitution = constraintSubstitution(constraint, type);
    return requiredFunctions(constraint.trait).flatMap((declaration, member) =>
      declaration.name.text === name
        ? [
            {
              declaration,
              substitution,
              origin: { kind: 'constraint', on, constraint: constraintIndex, member },
            },
          ]
        : [],
    );
  });
}

/**
 * The constraints `type` meets by what it is (§3.5, §3.10): a type parameter's, or an `any` type's,
 * each with `Self` the type itself; none for any other type.
 */
export function knownConstraints(checker: CheckerContext, type: Type): readonly Constraint[] {
  if (type.kind === 'any') {
    return type.constraints.map((constraint) => constraintOn(constraint, type));
  }
  return type.kind === 'parameter' && type.declaration.kind === 'TypeParameter'
    ? checker.constraintsOf(type.declaration)
    : [];
}

/** `constraint` of an `any` type as met by `type`: its trait's own `Self` replaced by `type`. */
export function constraintOn(constraint: Constraint, type: Type): Constraint {
  return substituteConstraint(constraint, new Map([[constraint.trait, type]]));
}

/** `constraint` with `substitution` applied to its trait's arguments. */
export function substituteConstraint(
  constraint: Constraint,
  substitution: Substitution,
): Constraint {
  return {
    trait: constraint.trait,
    arguments: constraint.arguments.map((argument) => substitute(argument, substitution)),
  };
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

/** The field `name` of `type`: a struct's, or, through a constraint on it, one its trait requires. */
export function fieldOf(checker: CheckerContext, type: Type, name: string): FoundField | undefined {
  if (type.kind === 'nominal' || type.kind === 'anonymous') {
    return structFieldOf(checker, type, name);
  }
  for (const constraint of knownConstraints(checker, type)) {
    const field = requiredFields(constraint.trait).find((each) => each.name.text === name);
    if (field !== undefined) {
      return {
        member: {
          name,
          type: requiredFieldType(checker, constraint, field, type),
          declared: {
            node: field,
            module: checker.moduleOf(constraint.trait),
            type: checker.resolveType(checker.moduleOf(constraint.trait), field.type),
          },
        },
        read: requiredFieldRead(checker, type, { trait: constraint.trait, field }),
      };
    }
  }
  return undefined;
}
