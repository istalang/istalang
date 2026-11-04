/**
 * How a value becomes an `any` type's (§3.10): a type converts into `any A & B` when it meets each
 * constraint, its own type standing for the constraint's `Self`, and an `any` type converts into
 * another whose constraints are among its own.
 *
 * Meeting is decided once per type and constraint, wherever it is asked (coherence, §3.10), so a
 * conversion records no witnesses: lowering finds them again for each type a value converts from.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { CheckerContext } from '../context.ts';
import type { ResolvedCall } from '../resolved-call.ts';
import { constraintOn } from '../traits/constraints.ts';
import { sameConstraint } from '../types/identity.ts';
import type { AnyType, Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { searchSite, type UseSite } from '../use-site.ts';
import { meets, witnessesFor } from './conformance.ts';

/** Whether a value of `found` converts into `target` (§3.10). */
export function meetsAny(checker: CheckerContext, found: Type, target: AnyType): boolean {
  if (found.kind === 'any') {
    return target.constraints.every((constraint) =>
      found.constraints.some((own) => sameConstraint(own, constraint)),
    );
  }
  const site = searchSite(checker);
  return target.constraints.every((constraint) =>
    meets(site, found, constraintOn(constraint, found)),
  );
}

/**
 * Reports at `site` the first constraint of `target` that `found`, not an `any` type, doesn't meet;
 * whether there was one.
 */
export function reportUnmet(site: UseSite, found: Type, target: AnyType): boolean {
  if (found.kind === 'any') {
    return false;
  }
  return target.constraints.some(
    (constraint) => !meets(site, found, constraintOn(constraint, found)),
  );
}

/** What a value of `member` inside `type` is called through for its `constraint`-th constraint. */
export function memberWitnesses(
  checker: CheckerContext,
  type: AnyType,
  constraint: number,
  member: Type,
): readonly ResolvedCall[] {
  const own = type.constraints[constraint];
  const witnesses =
    own === undefined
      ? undefined
      : witnessesFor(searchSite(checker), member, constraintOn(own, member));
  if (witnesses === undefined) {
    unreachable(`${typeText(member)} was converted into ${typeText(type)} without meeting it.`);
  }
  return witnesses;
}
