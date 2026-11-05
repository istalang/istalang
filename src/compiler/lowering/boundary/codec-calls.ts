/**
 * The codec of a type that code lowering writes calls (§9; docs/arch/boundary.md): the one the
 * checker finds, Encodable's or Decodable's witness, so a derived codec, a host extern's wrapper
 * and a start's outcome encoder call what checking let through. A wrapper of a generic extern finds
 * its codecs for the declared types, and closes them within its instance, so a type parameter's
 * codec is the witness its caller gave.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { JsonDirection } from '../../checker/json-form.ts';
import type { Type } from '../../checker/types/type.ts';
import { type ClosedCall, closeCall } from '../closed-calls.ts';
import type { FunctionInstance } from '../instances.ts';

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
  const codec = checker.json.codecOf(type, direction);
  if (codec === undefined) {
    unreachable(`A type crossing has no codec to ${direction}; checking should have said so.`);
  }
  return closeCall(codec, within, checker);
}
