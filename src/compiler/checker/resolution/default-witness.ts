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
import { conformWitnesses, witnessesFor } from './conformance.ts';

/** The call giving `type`'s default, Default's witness; undefined after `site` reports why not. */
export function defaultWitness(site: UseSite, type: Type): ResolvedCall | undefined {
  return witnessesFor(site, type, defaultConstraint(site.checker))?.[0];
}

/** What searching for `type`'s `Default` witness found. */
export type DefaultOutcome =
  | { readonly kind: 'call'; readonly call: ResolvedCall }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed' };

/**
 * `type`'s `default()` witness: `none` when none is declared, or `failed` after `site` reported
 * why the declared one doesn't meet `Default`.
 */
export function resolveDefault(site: UseSite, type: Type): DefaultOutcome {
  const outcome = conformWitnesses(site, type, defaultConstraint(site.checker));
  if (outcome.kind === 'undeclared') {
    return { kind: 'none' };
  }
  const [call] = outcome.kind === 'met' ? outcome.witnesses : [];
  return call === undefined ? { kind: 'failed' } : { kind: 'call', call };
}

function defaultConstraint(checker: CheckerContext): Constraint {
  return wellKnownConstraint(checker, wellKnown.default);
}
