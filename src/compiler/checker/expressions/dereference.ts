/**
 * `*x` (§3.9): the value behind the handle `x`. It is built in, as reading a field is, so it
 * resolves no call: lowering reads the handle's cell. `x->f` is `(*x).f`. `*x` is a place too:
 * written whole (`*x = v`) or in part (`x->f = v`), it is written as any place reached through a
 * pair of reads and writes is (calls/places.ts). The `x->` of `x->f` is a link of an optional
 * chain, as `.f` is, and `x?->` reads through an optional (optionals.ts); `*x` ends a chain, as a
 * prefix operator does.
 */

import { chainStepOf, type Dereference } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { optionalInner } from '../types/fit.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkDereference(context: BodyContext, node: Dereference): Type {
  return valueBehind(context, node) ?? errorType;
}

/** The value behind the handle `node` reads through; undefined after a report. */
function valueBehind(context: BodyContext, node: Dereference): Type | undefined {
  const handle =
    chainStepOf(node) === undefined
      ? context.expression(node.operand)
      : context.chains.target(context, node);
  if (handle.kind === 'error') {
    return undefined;
  }
  const { checker } = context;
  const sharedValue = checker.sharedValueOf(handle);
  if (sharedValue !== undefined) {
    return sharedValue;
  }
  const inner = optionalInner(handle, checker.optionalEntity);
  const throughArrow = inner !== undefined && chainStepOf(node) !== undefined;
  context.report(
    throughArrow && checker.sharedValueOf(inner) !== undefined
      ? checkerDiagnostics.insideOptional(node.span, typeText(handle), '?->')
      : checkerDiagnostics.notShared(node.span, typeText(handle)),
  );
  return undefined;
}
