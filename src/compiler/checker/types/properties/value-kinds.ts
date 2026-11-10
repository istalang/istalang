/**
 * The kinds a type's values belong to (proposal 8, Rule 2), for the rule that a function whose
 * signature holds one is of that kind, and that code makes none of the other: read on the walk
 * over what a value holds (held.ts), as whether it may leave its instance is (traits/sendable.ts).
 *
 * - A future holds its kind, `live`, `ista` or a variable; a handle that stays in its process
 *   (`extern live struct`) is `live`; a value whose release runs a `dispose` of a kind is of it,
 *   since releasing it calls that code (§7). Anything holding one at any depth is of its kind,
 *   whatever else it holds, a future's value among it, so one type may hold both kinds.
 * - A function is of no kind as a value: holding one isn't calling it (Rule 4).
 */

import { functionTypeParametersOf } from '../../../syntax/declarations/function-kinds.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { sameType } from '../identity/identity.ts';
import { substitute, substitutionFor } from '../parts/substitution.ts';
import { kindOfFunction } from '../type/function-kinds.ts';
import type { Type } from '../type/index.ts';
import { persistenceType } from '../type/primitives.ts';
import { awaitedOf } from '../type/well-known.ts';
import { isConfined, staysInProcess } from './handles.ts';
import { heldTypes } from './held.ts';

/**
 * The distinct kinds the parts a value of `type` holds are of, outermost first; none where no part
 * has one. The checker keeps each answer (`CheckerContext.valueKindsOf`).
 */
export function heldKindsOf(checker: CheckerContext, type: Type): readonly Type[] {
  return heldTypes(checker, type)
    .flatMap((part) => ownValueKindOf(checker, part) ?? [])
    .filter((kind, index, all) => all.findIndex((each) => sameType(each, kind)) === index);
}

/** The kind a value of `part` is of itself, by what it is, not what it holds; undefined for none. */
export function ownValueKindOf(checker: CheckerContext, part: Type): Type | undefined {
  if (part.kind !== 'nominal') {
    return undefined;
  }
  if (staysInProcess(part.entity.declaration)) {
    return persistenceType('live');
  }
  const awaited = awaitedOf(checker, part)?.mode;
  if (awaited !== undefined) {
    return awaited;
  }
  // Only a value with an identity of its own is disposable (rules/disposal/disposal.ts).
  if (!isConfined(part.entity.declaration)) {
    return undefined;
  }
  const disposal = checker.disposalOf(part);
  if (disposal.kind !== 'function') {
    return undefined;
  }
  const { function: dispose, typeArguments } = disposal.call;
  const kind = substitute(
    kindOfFunction(checker, dispose),
    substitutionFor(functionTypeParametersOf(dispose), typeArguments),
    checker.typeRules,
  );
  return kind.kind === 'union' ? undefined : kind;
}
