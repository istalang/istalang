/**
 * A type's `default()` (§2, §3.10): the function meeting `Default` for it, found as every witness
 * is, beside the type or the trait, so every construct that starts from a type's default finds
 * the same one wherever it is used.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { ResolvedCall } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { wellKnownConstraint } from '../traits/constraints.ts';
import type { Type } from '../types/type.ts';
import { searchSite } from '../use-site.ts';
import { witnessesFor } from './conformance.ts';

/** The call giving `type`'s default, Default's witness; undefined when it has none. */
export function defaultWitness(checker: CheckerContext, type: Type): ResolvedCall | undefined {
  return witnessesFor(
    searchSite(checker),
    type,
    wellKnownConstraint(checker, wellKnown.default),
  )?.[0];
}
