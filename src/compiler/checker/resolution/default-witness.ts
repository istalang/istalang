/**
 * A type's `default()` (§2, §3.10): the function meeting `Default` for it, found as every witness
 * is, beside the type or the trait, so every construct that starts from a type's default finds
 * the same one wherever it is used.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { ResolvedCall } from '../check.ts';
import { wellKnownConstraint } from '../traits/constraints.ts';
import type { Type } from '../types/type.ts';
import type { UseSite } from '../use-site.ts';
import { witnessesFor } from './conformance.ts';

/** The call giving `type`'s default, Default's witness; undefined after `site` reports why not. */
export function defaultWitness(site: UseSite, type: Type): ResolvedCall | undefined {
  const constraint = wellKnownConstraint(site.checker, wellKnown.default);
  return witnessesFor(site, type, constraint)?.[0];
}
