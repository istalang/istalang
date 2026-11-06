/**
 * `*x` (§3.9): the value behind the handle `x`. It is built in, as reading a field is, so it
 * resolves no call: lowering reads the handle's cell. `x->f` is `(*x).f`. `*x` is a place too:
 * written whole (`*x = v`) or in part (`x->f = v`), it is written as any place reached through a
 * pair of reads and writes is (resolution/calls/places.ts). The `x->` of `x->f` is a link of an
 * optional chain, as `.f` is, and `x?->` reads through an optional (optionals.ts); `*x` ends a
 * chain, as a prefix operator does.
 */

import { chainStepOf } from '../../../../syntax/expressions/chains.ts';
import type { Dereference } from '../../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type-text.ts';
import { insideOptional } from '../../../types/unions/inside-optional.ts';

export function checkDereference(context: BodyContext, node: Dereference): Type {
  const isLink = chainStepOf(node) !== undefined;
  const handle = isLink ? context.chains.target(context, node) : context.expression(node.operand);
  return (
    stoppedOperation(context, node, [{ node: node.operand, type: handle }]) ??
    valueBehind(context, node, handle, isLink) ??
    errorType
  );
}

/** The value behind `handle`, which `node` reads through; undefined after a report. */
function valueBehind(
  context: BodyContext,
  node: Dereference,
  handle: Type,
  isLink: boolean,
): Type | undefined {
  const { checker } = context;
  const sharedValue = checker.sharedValueOf(handle);
  if (sharedValue !== undefined) {
    return sharedValue;
  }
  const inside = isLink ? insideOptional(node.span, handle, '->') : undefined;
  context.report(inside ?? checkerDiagnostics.notShared(node.span, typeText(handle)));
  return undefined;
}
