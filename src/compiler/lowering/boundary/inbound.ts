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
import type { Checker } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import type { CodeContext } from '../context.ts';
import { emitFunctionCall } from '../emit-call.ts';
import { type ClosedCall, closeCall, type FunctionInstance } from '../instances.ts';
import { codecCall } from './codec-calls.ts';

/** How JSON at `path` becomes a value: the call decoding it, and the call accepting the result. */
export interface Inbound {
  readonly path: string;
  readonly decode: ClosedCall;
  readonly accept: ClosedCall;
}

/**
 * JSON at `path` read as `type` by its codec, a mismatch handled by the json module's `accept`,
 * both closed `within` the instance reading it.
 */
export function inboundOf(
  checker: Checker,
  within: FunctionInstance | undefined,
  type: Type,
  { accept, path }: { readonly accept: CodecHelper; readonly path: string },
): Inbound {
  return {
    path,
    decode: codecCall(checker, within, type, 'read'),
    accept: closeCall(checker.json.callOf(accept, [type]), within),
  };
}

/** The value the JSON in `json` holds, read as `inbound` says. */
export function emitInbound(
  context: CodeContext,
  json: Register,
  inbound: Inbound,
  span: Span,
): Register {
  const path = context.code.allocate();
  context.code.emit({
    kind: 'constant',
    span,
    dst: path,
    constant: context.tables.constant(inbound.path),
  });
  const call = (target: ClosedCall, values: readonly Register[]) =>
    emitFunctionCall(context, { span, call: target, arguments: values });
  return call(inbound.accept, [call(inbound.decode, [json, path])]);
}
