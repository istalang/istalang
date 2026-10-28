/**
 * The codec of a type that code lowering writes calls (§9; docs/arch/boundary.md): the one the
 * checker finds, Encodable's or Decodable's witness, so a derived codec, a host extern's wrapper,
 * a start entry and an instance's outcome encoder call what checking let through. A wrapper of a
 * generic extern finds its codecs for the declared types, and closes them within its instance, so
 * a type parameter's codec is the witness its caller gave.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { JsonDirection } from '../../checker/json-form.ts';
import type { Type } from '../../checker/types/type.ts';
import { type ClosedCall, closeCall, type FunctionInstance } from '../instances.ts';
import type { DefinitionTables } from '../tables.ts';

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
  return closeCall(codec, within);
}

/**
 * The entry encoding an instance's outcome of type `type` for its host (§9): its codec's, which the
 * runtime calls once the instance's root returns; undefined when no codec writes `type`.
 */
export function outcomeEncoderIndex(
  lowering: { readonly checker: Checker; readonly tables: DefinitionTables },
  type: Type,
): FunctionId | undefined {
  const codec = lowering.checker.json.codecOf(type, 'write');
  return codec === undefined ? undefined : lowering.tables.callIndex(closeCall(codec, undefined));
}
