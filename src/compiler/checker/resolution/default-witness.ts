/**
 * A type's `default()` (§2, §3.10): the function meeting `Default` for it, found as every witness
 * is, beside the type or the trait, so every construct that starts from a type's default finds
 * the same one wherever it is used.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { CheckerContext } from '../context.ts';
import type { ResolvedCall } from '../resolved-call.ts';
import { wellKnownConstraint } from '../traits/constraints.ts';
import type { Constraint, Type } from '../types/type.ts';
import type { UseSite } from '../use-site.ts';
import { witnessesFor } from './conformance.ts';

/**
 * The call giving `type`'s default, Default's witness; undefined after `site` reports why a
 * declared one doesn't meet Default, or `onNone` reports that none is declared.
 */
export function defaultWitness(
  site: UseSite,
  type: Type,
  onNone?: () => void,
): ResolvedCall | undefined {
  return witnessesFor(site, type, defaultConstraint(site.checker), onNone)?.[0];
}

function defaultConstraint(checker: CheckerContext): Constraint {
  return wellKnownConstraint(checker, wellKnown.default);
}
