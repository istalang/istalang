/**
 * The codec of a type that code lowering writes calls (§17.4; docs/arch/boundary.md): the one the
 * checker finds, Encodable's or Decodable's witness, so a derived codec, a host extern's wrapper
 * and an instance's outcome encoder, a start's or an `Instance<T>` type entry's, call what checking
 * let through. A wrapper of a generic extern finds
 * its codecs for the declared types, and closes them within its instance, so a type parameter's
 * codec is the witness its caller gave.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import type { JsonDirection } from '../../../checker/surface/json-form.ts';
import type { FunctionInstance } from '../../../checker/surface/witness-closing.ts';
import type { Type } from '../../../checker/types/type/index.ts';
import { type ClosedCall, closeCall } from '../../calls/closed-calls.ts';

/**
 * The codec writing or reading `type`, which checking let through, closed `within` the instance
 * calling it when it is generic.
 */
export function codecCall(
  checker: Checker,
  within: FunctionInstance | undefined,
  type: Type,
  direction: JsonDirection,
): ClosedCall {
  return (
    foundCodecCall(checker, within, type, direction) ??
    unreachable(`A type crossing has no codec to ${direction}; checking should have said so.`)
  );
}

/** The codec writing or reading `type` as `codecCall` gives it; undefined when none does. */
export function foundCodecCall(
  checker: Checker,
  within: FunctionInstance | undefined,
  type: Type,
  direction: JsonDirection,
): ClosedCall | undefined {
  const codec = checker.json.codecOf(type, direction);
  return codec === undefined ? undefined : closeCall(codec, within, checker);
}
