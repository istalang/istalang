/**
 * How a value becomes an `any` type's (§3.10): a type converts into `any A & B` when it meets each
 * constraint, its own type standing for the constraint's `Self`, and an `any` type converts into
 * another whose constraints are among its own.
 *
 * Meeting is decided once per type and constraint, wherever it is asked (coherence, §3.10), so a
 * conversion records no witnesses: lowering finds them again for each type a value converts from.
 */

import type { CheckerContext } from '../context.ts';
import {
  type AnyType,
  type Constraint,
  sameConstraint,
  substitute,
  type Type,
} from '../types/type.ts';
import { searchSite } from '../use-site.ts';
import { meets } from './conformance.ts';

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

/** `constraint` of an `any` type as met by `type`: its `Self` replaced by `type` (§3.10). */
export function constraintOn(constraint: Constraint, type: Type): Constraint {
  const self = new Map([[constraint.trait, type]]);
  return {
    trait: constraint.trait,
    arguments: constraint.arguments.map((argument) => substitute(argument, self)),
  };
}
