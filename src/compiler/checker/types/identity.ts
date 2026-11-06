/**
 * One home for type identity (§2, §3.1): two types are the same type exactly when their keys are
 * equal (type-keys.ts), so no second, structural notion of sameness can drift from the key every
 * map keyed by type uses. A shape is the same type wherever and in whatever order it is written,
 * and an alias is the type it names, because the key says so.
 *
 * The exact relations built on it live here too: assignability, which only `Never`, the error type
 * and a function's looser header (`functionFits`) widen, and constraints compared one by one.
 */

import { sameItems } from '../../../structures/equality.ts';
import { functionFits } from './function-types.ts';
import { isPrimitive } from './primitives.ts';
import type { Constraint, Type } from './type.ts';
import { typeKeys } from './type-keys.ts';

/** Whether two types are the same type: their keys are equal. */
export function sameType(first: Type, second: Type): boolean {
  return first === second || typeKeys.typeKey(first) === typeKeys.typeKey(second);
}

/** Whether two constraints are one trait with the same arguments. */
export function sameConstraint(first: Constraint, second: Constraint): boolean {
  return first.trait === second.trait && sameItems(sameType)(first.arguments, second.arguments);
}

/**
 * Whether a value of type `source` fits where `target` is expected: the same type, or a function
 * whose sendability is at least `target`'s and whose result fits `target`'s (§2, §3.14).
 */
export function isAssignable(source: Type, target: Type): boolean {
  return (
    source.kind === 'error' ||
    target.kind === 'error' ||
    isPrimitive(source, 'Never') ||
    sameType(source, target) ||
    (source.kind === 'function' &&
      target.kind === 'function' &&
      functionFits(target, source, sameType, (declared, given) => isAssignable(given, declared)))
  );
}
