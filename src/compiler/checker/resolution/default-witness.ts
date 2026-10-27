/**
 * A type's `default()` (§2, §3.10): the function meeting `Default` for it, found as every witness
 * is, beside the type or the trait, so every construct that starts from a type's default finds
 * the same one wherever it is used.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { CheckerContext } from '../context.ts';
import type { ResolvedCall } from '../resolved-call.ts';
import { type Constraint, wellKnownConstraint } from '../traits/constraints.ts';
import type { Type } from '../types/type.ts';
import type { UseSite } from '../use-site.ts';
import { witnessesFor } from './conformance.ts';
import { declaresWitness } from './declared-witness.ts';

/** The call giving `type`'s default, Default's witness; undefined after `site` reports why not. */
export function defaultWitness(site: UseSite, type: Type): ResolvedCall | undefined {
  return witnessesFor(site, type, defaultConstraint(site.checker))?.[0];
}

/** Whether a `default()` is declared for `type`, whether or not it meets Default. */
export function declaresDefault(checker: CheckerContext, type: Type): boolean {
  return declaresWitness(checker, type, defaultConstraint(checker));
}

function defaultConstraint(checker: CheckerContext): Constraint {
  return wellKnownConstraint(checker, wellKnown.default);
}
