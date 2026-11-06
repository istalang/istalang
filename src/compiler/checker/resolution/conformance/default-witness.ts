/**
 * A type's `default()` (§2, §3.10): the function meeting `Default` for it, found as every witness
 * is, beside the type or the trait, so every construct that starts from a type's default finds
 * the same one wherever it is used.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import type { ResolvedCall } from '../../surface/resolved-call.ts';
import { wellKnownConstraint } from '../../types/traits/constraints.ts';
import type { Constraint, Type } from '../../types/type/index.ts';
import { conformWitnesses, witnessesFor } from './conformance.ts';
import type { ConformanceOutcome } from './witness-outcomes.ts';

/** The call giving `type`'s default, Default's witness; undefined after `site` reports why not. */
export function defaultWitness(site: UseSite, type: Type): ResolvedCall | undefined {
  return witnessesFor(site, type, defaultConstraint(site.checker))?.[0];
}

/**
 * `type`'s `Default` conformance: `undeclared` when no `default()` is declared, or `failed` after
 * `site` reported why the declared one doesn't meet `Default`.
 */
export function resolveDefault(site: UseSite, type: Type): ConformanceOutcome {
  return conformWitnesses(site, type, defaultConstraint(site.checker));
}

function defaultConstraint(checker: CheckerContext): Constraint {
  return wellKnownConstraint(checker, wellKnown.default);
}
