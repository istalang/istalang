/**
 * The kinds the checker keeps as entries of its own (proposal 8, Rules 2–4): each function's kind,
 * the kinds what a type's values hold are of, and what each type parameter qualifies functions by, so each is found once per revision however many
 * signatures and calls ask, and a later revision takes it over where what it read answers alike.
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Fitting } from '../../types/fitting/fit/index.ts';
import { standingFor } from '../../types/inference/variables.ts';
import { sameTypeSpelled } from '../../types/parts/type-parts.ts';
import { qualifierParameterOf } from '../../types/properties/qualifiers.ts';
import {
  composedKindsOf,
  declaredKindsOf,
  heldKindsOf,
  type KeptKinds,
  walkedKindsOf,
} from '../../types/properties/value-kinds.ts';
import { functionKindOf } from '../../types/type/function-kinds.ts';
import type { NominalEntity, Type } from '../../types/type/index.ts';

/** The checker's kind queries over `checker`'s entries. */
export function programKinds(
  checker: CheckerContext,
): Pick<CheckerContext, 'kindOf' | 'valueKindsOf'> {
  const functions = checker.entries.table({
    name: 'function kinds',
    compute: (declaration: Parameters<CheckerContext['kindOf']>[0]) =>
      functionKindOf(checker, declaration),
    equal: sameTypeSpelled,
  });
  const declarations = checker.entries.table({
    name: 'declared kinds',
    compute: (entity: NominalEntity) => declaredKindsOf(checker, entity),
    equal: (first, second) =>
      sameItems(sameTypeSpelled)(first.marks, second.marks) &&
      sameItems(sameTypeSpelled)(first.dependent, second.dependent),
    cyclic: { standIn: () => ({ marks: [], dependent: [] }) },
  });
  const walked = checker.entries.table({
    name: 'walked kinds',
    compute: (_key: string, type: Type) => walkedKindsOf(checker, type),
    equal: sameItems(sameTypeSpelled),
    cyclic: { standIn: () => [] },
  });
  const composed = checker.entries.table({
    name: 'composed kinds',
    compute: (_key: string, type: Type) => composedKindsOf(checker, type, kept),
    equal: sameItems(sameTypeSpelled),
    cyclic: { standIn: () => [] },
  });
  const kept: KeptKinds = {
    declaredOf: (entity) => declarations.get(entity),
    composedOf: (type) => composed.get(checker.typeKeys.typeKey(type), type),
    walkedOf: (type) => walked.get(checker.typeKeys.typeKey(type), type),
  };
  return {
    kindOf: (declaration) => functions.get(declaration),
    valueKindsOf: (type) => heldKindsOf(checker, type, kept),
  };
}

/**
 * What each type parameter qualifies functions by (types/properties/qualifiers.ts), kept in
 * `checker`'s entries; a call's variable, a twin of the parameter it stands for
 * (types/inference/variables.ts), is asked as that parameter.
 */
export function programQualifiers(checker: CheckerContext): Fitting['qualifierOf'] {
  const qualifiers = checker.entries.table({
    name: 'qualifier parameters',
    compute: (parameter: TypeParameter) => qualifierParameterOf(checker, parameter),
    equal: (first, second) =>
      first?.order === second?.order && first?.mayBeBottom === second?.mayBeBottom,
  });
  return (parameter) => {
    const standing = standingFor(parameter);
    return standing.kind === 'TypeParameter' ? qualifiers.get(standing) : undefined;
  };
}
