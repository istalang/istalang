/**
 * The codec of a type that code lowering writes calls (§9; docs/arch/boundary.md): the one the
 * checker finds where the code stands, as Encodable's or Decodable's witness would be, so a derived
 * codec, a host extern's wrapper and a start entry call what checking let through. A wrapper of a
 * generic extern finds its codecs for the declared types, and closes them within its instance, so
 * a type parameter's codec is the witness its caller gave.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker, FunctionCall } from '../../checker/check.ts';
import type { JsonDirection } from '../../checker/json-form.ts';
import type { Type } from '../../checker/types/type.ts';
import type { ModuleId } from '../../program/program.ts';
import { closeCall, type FunctionInstance } from '../instances.ts';

/** Where a codec is found: by code in `module`, closed `within` an instance when it is generic. */
export interface CodecSite {
  readonly module: ModuleId;
  readonly within: FunctionInstance | undefined;
}

/** The codec writing or reading `type` that code at `site` calls, which checking let through. */
export function codecCall(
  checker: Checker,
  site: CodecSite,
  type: Type,
  direction: JsonDirection,
): FunctionCall {
  const codec = checker.json.codecOf(type, direction, site.module);
  if (codec === undefined) {
    unreachable(`A type crossing has no codec to ${direction}; checking should have said so.`);
  }
  return closeCall(codec, site.within);
}
