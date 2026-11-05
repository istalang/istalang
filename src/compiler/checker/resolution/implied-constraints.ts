/**
 * What an `infer` variable carries from where it stands (§3.17): a case's pattern is a type, so the
 * part it binds is a type argument some declaration constrains, and it meets those constraints in
 * any type the case matches. `Field<infer T>`, with `struct Field<T is Encodable>`, gives `T` the
 * constraint `Encodable` in the case's type, beside any written `infer T is C`.
 *
 * - The places are found in the pattern as resolved: each nominal type, alias spelling or `any`
 *   constraint holding the variable as an argument gives its parameter's constraints, substituted
 *   for the arguments written beside it.
 * - A struct case's entries are walked alike: an exact type, or a trait an entry must meet.
 */

import { type TypeParameter, typeParametersOf } from '../../syntax/declarations.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree.ts';
import type { CheckerContext } from '../context.ts';
import {
  type ConstraintSet,
  type StructConstraintModel,
  substituteStructConstraint,
} from '../types/struct-constraint.ts';
import { substituteConstraint, substitutionFor } from '../types/substitution.ts';
import type { Constraint, Type } from '../types/type.ts';
import { typeChildren } from '../types/type-children.ts';

/** A declaration's parameter list and the arguments a use gives it. */
interface Use {
  readonly parameters: Parameters<typeof typeParametersOf>[0];
  readonly arguments: readonly Type[];
}

/** The constraints `parameter`, an `infer` variable, carries from where it stands; else none. */
export function impliedConstraints(
  checker: CheckerContext,
  tree: SyntaxTree,
  parameter: TypeParameter,
): ConstraintSet {
  const pattern = casePatternOf(checker, tree, parameter);
  if (pattern === undefined || pattern.kind === 'any') {
    return { traits: [], structs: [] };
  }
  const uses = pattern.kind === 'type' ? usesIn(pattern.type) : usesInStruct(pattern.constraint);
  const rules = checker.typeRules;
  const traits: Constraint[] = [];
  const structs: StructConstraintModel[] = [];
  for (const use of uses) {
    const substitution = substitutionFor(use.parameters, use.arguments);
    typeParametersOf(use.parameters).forEach((declared, index) => {
      const argument = use.arguments[index];
      if (argument?.kind !== 'parameter' || argument.declaration !== parameter) {
        return;
      }
      for (const constraint of checker.constraintsOf(declared)) {
        traits.push(substituteConstraint(constraint, substitution, rules));
      }
      for (const struct of checker.structConstraintsOf(declared)) {
        structs.push(substituteStructConstraint(struct, substitution, rules));
      }
    });
  }
  return { traits, structs };
}

/** The resolved pattern of the case whose pattern declares `parameter`; undefined elsewhere. */
function casePatternOf(checker: CheckerContext, tree: SyntaxTree, parameter: TypeParameter) {
  if (parentOf(tree, parameter)?.kind !== 'InferType') {
    return;
  }
  let node: SyntaxNode | undefined = parameter;
  while (node !== undefined && node.kind !== 'TypeCase') {
    node = parentOf(tree, node);
  }
  const typeCase = node;
  const typeMatch = typeCase === undefined ? undefined : parentOf(tree, typeCase);
  const alias = typeMatch === undefined ? undefined : parentOf(tree, typeMatch);
  if (
    typeCase?.kind !== 'TypeCase' ||
    (alias?.kind !== 'TypeAliasDeclaration' && alias?.kind !== 'AssociatedType')
  ) {
    return;
  }
  return checker.typeMatches.typeMatchOf(alias)?.cases.find((each) => each.node === typeCase)
    ?.pattern;
}

/** Every use in `type`, at any depth, giving a declaration's parameters their arguments. */
function usesIn(type: Type): readonly Use[] {
  const own: Use[] = [];
  if (type.kind === 'nominal') {
    own.push({
      parameters: type.entity.declaration.typeParameters,
      arguments: type.arguments,
    });
  }
  if (type.alias?.kind === 'alias') {
    own.push({
      parameters: type.alias.declaration.typeParameters,
      arguments: type.alias.arguments,
    });
  }
  if (type.kind === 'any') {
    own.push(...type.constraints.map(traitUse));
  }
  const spelled = type.alias?.kind === 'alias' ? type.alias.arguments : [];
  return [...own, ...[...typeChildren(type), ...spelled].flatMap(usesIn)];
}

/** Every use in a struct case's entries: their exact types and the traits they must meet. */
function usesInStruct(model: StructConstraintModel): readonly Use[] {
  const rules = [
    ...model.named.map((entry) => entry.rule),
    ...(model.others ? [model.others] : []),
  ];
  return rules.flatMap((rule) =>
    rule.kind === 'type'
      ? usesIn(rule.type)
      : [
          ...rule.traits.flatMap((trait) => [traitUse(trait), ...trait.arguments.flatMap(usesIn)]),
          ...rule.structs.flatMap(usesInStruct),
        ],
  );
}

function traitUse(constraint: Constraint): Use {
  return { parameters: constraint.trait.typeParameters, arguments: constraint.arguments };
}
