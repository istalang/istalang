/**
 * JSON crossing in from the host (§9; docs/arch/boundary.md), as code: decoded by the type's codec
 * at a path a failure names, then accepted by a helper that decides what a mismatch does. A
 * result, what its future gives, or an extern constant's value that doesn't fit panics the code
 * reading it (`_hostResult`); JSON a host starts an instance with fails the host's call
 * (`_hostInput`).
 * Host extern wrappers and start entries both read JSON this one way.
 */

import type { Register } from '../../../../definition/operands.ts';
import {
  type CodecHelper,
  codecHelpers,
} from '../../../../foundation/language/well-known/codecs.ts';
import type { Checker } from '../../../checker/check.ts';
import type { FunctionInstance } from '../../../checker/surface/witness-closing.ts';
import type { Type } from '../../../checker/types/type/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { type ClosedCall, closeCall } from '../../calls/closed-calls.ts';
import { emitFunctionCall } from '../../calls/emit-call.ts';
import type { CodeContext } from '../../context.ts';
import { codecCall } from './codec-calls.ts';

/** The helper accepting what was read, by whom JSON came from: what a mismatch does. */
const acceptors = {
  result: codecHelpers.hostResult,
  input: codecHelpers.hostInput,
} as const satisfies Record<string, CodecHelper>;

/**
 * Where JSON crossing in comes from: a host's result, what its future gives or an extern
 * constant's value (`result`), or what a host starts an instance with (`input`).
 */
export type InboundSource = keyof typeof acceptors;

/** How JSON at `path` becomes a value: the call decoding it, and the call accepting the result. */
export interface Inbound {
  readonly path: string;
  readonly decode: ClosedCall;
  readonly accept: ClosedCall;
}

/**
 * JSON at `path`, from `from`, read as `type` by its codec and accepted as its source says, both
 * calls closed `within` the instance reading it.
 */
export function inboundOf(
  checker: Checker,
  within: FunctionInstance | undefined,
  type: Type,
  { from, path }: { readonly from: InboundSource; readonly path: string },
): Inbound {
  return {
    path,
    decode: codecCall(checker, within, type, 'read'),
    accept: closeCall(checker.json.callOf(acceptors[from], [type]), within, checker),
  };
}

/** The value the JSON in `json` holds, read as `inbound` says. */
export function emitInbound(
  context: CodeContext,
  json: Register,
  inbound: Inbound,
  span: AnchoredSpan,
): Register {
  const path = context.constant(inbound.path, span);
  const call = (target: ClosedCall, values: readonly Register[]) =>
    emitFunctionCall(context, { span, call: target, arguments: values });
  return call(inbound.accept, [call(inbound.decode, [json, path])]);
}
