/**
 * JSON crossing in from the host (§9; docs/arch/boundary.md), as code: decoded by the type's codec
 * at a path a failure names, then accepted by a helper that decides what a mismatch does. A
 * result or an extern constant's value that doesn't fit panics the instance (`_hostResult`); JSON
 * a host starts an instance with, or fills a future with, fails the host's call (`_hostInput`).
 * Host extern wrappers and start entries both read JSON this one way.
 */

import type { Register } from '../../../definition/operands.ts';
import type { CodecHelper } from '../../../language/well-known.ts';
import type { Span } from '../../../text/span.ts';
import type { Checker, FunctionCall } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import type { CodeContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { instanceOfCall } from '../instances.ts';

/** How JSON at `path` becomes a value: the call decoding it, and the call accepting the result. */
export interface Inbound {
  readonly path: string;
  readonly decode: FunctionCall;
  readonly accept: FunctionCall;
}

/** JSON at `path` read as `type`, a mismatch handled by the json module's `accept`. */
export function inboundOf(
  checker: Checker,
  type: Type,
  accept: CodecHelper,
  path: string,
): Inbound {
  return {
    path,
    decode: checker.json.decoderOf(type),
    accept: checker.json.callOf(accept, [type]),
  };
}

/** The value the JSON in `json` holds, read as `inbound` says; `path` holds its path's text. */
export function emitInbound(
  context: CodeContext,
  { json, path }: { readonly json: Register; readonly path: Register },
  inbound: Inbound,
  span: Span,
): Register {
  const call = (target: FunctionCall, values: readonly Register[]) =>
    emitCall(context, {
      span,
      callee: context.tables.functionIndex(instanceOfCall(target)),
      arguments: values,
    });
  return call(inbound.accept, [call(inbound.decode, [json, path])]);
}
