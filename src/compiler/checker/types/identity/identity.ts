/**
 * One home for type identity (§2, §3.1): two types are the same type exactly when their keys are
 * equal (type-keys.ts), so no second, structural notion of sameness can drift from the key every
 * map keyed by type uses. A shape is the same type wherever and in whatever order it is written,
 * and an alias is the type it names, because the key says so.
 *
 * The exact relations built on it live here too: assignability, which only `Never`, a future of
 * it, the error type and a function's looser header (`functionFits`) widen, and constraints
 * compared one by one. A future of `Never` never gives a value, so it is a future of any type
 * (§3.14), as `Never` is a value of any type (§2).
 */

import { sameItems } from '../../../../foundation/structures/equality.ts';
import { kindAdmits } from '../type/function-kinds.ts';
import { type Futures, functionFits } from '../type/function-types.ts';
import type { Constraint, Type } from '../type/index.ts';
import { isPrimitive } from '../type/primitives.ts';
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
 * Whether a value of type `source` fits where `target` is expected as it is: the same type, a
 * future of `Never` where a future of its kind is, or a function whose sendability is at least
 * `target`'s and whose result fits `target`'s (§2, §3.14).
 */
export function isAssignable(
  source: Type,
  target: Type,
  futures: Pick<Futures, 'awaitedOf'>,
): boolean {
  return (
    source.kind === 'error' ||
    target.kind === 'error' ||
    isPrimitive(source, 'Never') ||
    sameType(source, target) ||
    neverFutureFits(source, target, futures) ||
    (source.kind === 'function' &&
      target.kind === 'function' &&
      functionFits(target, source, {
        parts: sameType,
        results: (declared, given) => resultAssignable(given, declared, futures),
        kinds: (code, callee) => kindAdmits(code, callee, sameType),
      }))
  );
}

/**
 * Whether `source` is a future of `Never`, which never gives a value, and `target` a future of its
 * kind, which the kinds never leave (proposal 8, Rule 4).
 */
function neverFutureFits(
  source: Type,
  target: Type,
  { awaitedOf }: Pick<Futures, 'awaitedOf'>,
): boolean {
  const never = awaitedOf(source);
  const into = awaitedOf(target);
  return (
    never !== undefined &&
    into !== undefined &&
    isPrimitive(never.value, 'Never') &&
    sameType(never.mode, into.mode)
  );
}

/**
 * Whether a function's result `given` fits as it is where `declared` is: as a value does, but for
 * one that is no future where a future is, which a function giving it goes into only made async
 * (fitting/fit/index.ts), `Never` too: its call never gives the future expected.
 */
function resultAssignable(
  given: Type,
  declared: Type,
  futures: Pick<Futures, 'awaitedOf'>,
): boolean {
  const madeAsync =
    given.kind !== 'error' &&
    futures.awaitedOf(given)?.value === undefined &&
    futures.awaitedOf(declared)?.value !== undefined;
  return !madeAsync && isAssignable(given, declared, futures);
}
