/**
 * What a witness search finds (conformance.ts, §3.10): a witness, or why there is none. A search
 * that fails has reported why at its use site already; one reaching the depth bound counts as
 * endless, which every level up reports as such.
 */

import type { ResolvedCall } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';

/** How deeply witness searches nest before one counts as endless. */
export const maximumDepth = 16;

/**
 * Why a search failed, after reporting it at its use site: `endless` when a witness search reached
 * the depth bound, which every level up reports as such, and `failed` for any other cause.
 */
export type Failure = 'failed' | 'endless';

export function isFailure<Found>(outcome: Found | Failure): outcome is Failure {
  return outcome === 'failed' || outcome === 'endless';
}

/**
 * What searching for a single required function's witness found: the call, nothing declared
 * (`none`), several candidates tying (`ambiguous`), a declared function giving another result
 * (`wrongResult`), or a declared function whose own instantiation failed (`failed` / `endless`).
 */
export type WitnessOutcome =
  | { readonly kind: 'call'; readonly call: ResolvedCall }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'wrongResult'; readonly required: Type; readonly given: Type }
  | { readonly kind: 'failed' }
  | { readonly kind: 'endless' };

/** What searching for a constraint's witnesses found, distinguishing an undeclared function from a failure. */
export type ConformanceOutcome =
  | { readonly kind: 'met'; readonly witnesses: readonly ResolvedCall[] }
  | { readonly kind: 'undeclared' }
  | { readonly kind: 'failed' };
