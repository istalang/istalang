/**
 * The function a deferred call gives its taker (§3.14), as an argument of the taker's call. It is
 * built from what its call computes now, so it is sendable when each of those values is; where a
 * sendable function is expected and it isn't one, as `spawn` takes (§9), the misfit is explained at
 * each value that isn't sendable, rather than as two function types.
 */

import type { DeferredCall } from '../../../syntax/expressions/calls.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { isSendable } from '../../types/traits/sendable.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import type { StoppingOperand } from './stopped-operations.ts';

/** The function a deferred call gives: the deferred call, and what its call computes now. */
export interface DeferredArgument {
  readonly node: DeferredCall;
  /** Each value the call computes now, in the order it runs, with its type. */
  readonly computed: readonly StoppingOperand[];
}

/** What of `computed` isn't sendable, so a function capturing it can't be. */
export function unsendable(
  context: Pick<BodyContext, 'checker'>,
  computed: readonly StoppingOperand[],
): readonly StoppingOperand[] {
  return computed.filter(({ type }) => type.kind !== 'error' && !isSendable(context.checker, type));
}

/**
 * Reports each value `deferred` captures that isn't sendable, where `expected` is a sendable
 * function; whether that explained why it doesn't fit there.
 */
export function explainedCaptures(
  context: BodyContext,
  deferred: DeferredArgument,
  expected: Type,
): boolean {
  if (expected.kind !== 'function' || expected.reach !== 'sendable') {
    return false;
  }
  const captured = unsendable(context, deferred.computed);
  for (const { node, type } of captured) {
    context.report(checkerDiagnostics.unsendableCapture(node.span, typeText(type)));
  }
  return captured.length > 0;
}
