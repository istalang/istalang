/**
 * Type arguments given a generic declaration (§3.5): completed with the defaults of the parameters
 * left out, and noted for the checks an instantiation needs, which run when the module giving them
 * is checked (resolve-type.ts says why later).
 *
 * - A default is written in the declaring module and may name the parameters before it (and, in a
 *   trait, `Self`), so it is resolved there and then substituted. This module is the one place
 *   that fills them.
 * - Every argument of a constrained parameter is noted for its constraints, in a type `match`
 *   case's pattern too, a type like any other; an instantiation is also noted for the type
 *   `match`es it reaches, which must reduce, except in a pattern, which is matched, not used.
 */

import type { ModuleId } from '../../../program/program.ts';
import {
  type GenericDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { substitute, substitutionFor } from '../parts/substitution.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import { reportWritten, type Written } from './written.ts';

/**
 * Type arguments given a generic declaration at `at`; `self` is what a trait's `Self` stands for.
 */
interface ArgumentList {
  readonly at: AnchoredSpan;
  readonly declaration: GenericDeclaration;
  readonly types: readonly Type[];
  readonly self?: Type;
}

/**
 * The arguments for every type parameter of the list's declaration: the written ones, then the
 * defaults of the ones left out. Undefined after reporting that too few or too many were written.
 */
export function typeArgumentsFor(
  where: Written,
  { at, declaration, types: written, self }: ArgumentList,
): readonly Type[] | undefined {
  const { checker } = where;
  const parameters = typeParametersOf(declaration.typeParameters);
  const required = parameters.filter((parameter) => parameter.defaultType === undefined).length;
  if (written.length < required || written.length > parameters.length) {
    const expected = written.length < required ? required : parameters.length;
    reportWritten(
      where,
      checkerDiagnostics.typeArgumentCount(at, declaration.name.text, expected, written.length),
    );
    return undefined;
  }
  const substitution = new Map<ParameterKey, Type>();
  if (self !== undefined && declaration.kind === 'TraitDeclaration') {
    substitution.set(declaration, self);
  }
  return parameters.map((parameter, index) => {
    const argument =
      written[index] ?? defaultArgument(checker, declaration, parameter, substitution);
    substitution.set(parameter, argument);
    return argument;
  });
}

/**
 * The default of `parameter`, resolved where `declaration` is written, with the parameters
 * before it (and `Self`) as `earlier` maps them; the error type when it has none.
 */
export function defaultArgument(
  checker: CheckerContext,
  declaration: GenericDeclaration,
  parameter: TypeParameter,
  earlier: ReadonlyMap<ParameterKey, Type>,
): Type {
  if (parameter.defaultType === undefined) {
    return errorType;
  }
  return substitute(
    checker.resolveType(checker.moduleOf(declaration), parameter.defaultType),
    earlier,
    checker.typeRules,
  );
}

/**
 * Notes every argument of a constrained parameter in a complete list for its constraints, and the
 * instantiation for the type `match`es it reaches (§3.5, §3.17): a type's, whose associated types
 * each use reduces, whatever its arity, and a generic or type `match` alias's, whose body each use
 * reduces; a plain alias's body without parameters reduces once, where it is written.
 */
export function constrainArguments(checker: CheckerContext, module: ModuleId, list: ArgumentList) {
  noteConstraints(checker, module, list);
  const { at, declaration, types: typeArguments } = list;
  const reducesPerUse =
    declaration.kind !== 'TypeAliasDeclaration' ||
    declaration.type.kind === 'TypeMatch' ||
    typeParametersOf(declaration.typeParameters).length > 0;
  if (declaration.kind !== 'TraitDeclaration' && reducesPerUse) {
    checker.constrainLater(module, {
      kind: 'reduces',
      at,
      declaration,
      typeArguments: substitutionFor(declaration.typeParameters, typeArguments),
    });
  }
}

/**
 * Notes every argument of a constrained parameter in a complete list for its constraints: in a
 * type `match` case's pattern too, which must be a well-formed type, its `infer` variables meeting
 * what their places imply (resolution/type-matches/implied-constraints.ts).
 */
export function noteConstraints(
  checker: CheckerContext,
  module: ModuleId,
  { at, declaration, types: typeArguments }: ArgumentList,
): void {
  const substitution = substitutionFor(declaration.typeParameters, typeArguments);
  const checked = typeParametersOf(declaration.typeParameters).filter(
    (each) => each.constraints.length > 0 || each.memberOf !== undefined,
  );
  for (const parameter of checked) {
    checker.constrainLater(module, { kind: 'meets', at, parameter, typeArguments: substitution });
  }
}
