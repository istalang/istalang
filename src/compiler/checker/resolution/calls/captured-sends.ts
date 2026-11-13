/**
 * Why a closure isn't sendable where a sendable function is taken (§3.14, §9): it captures a value
 * that isn't. Where a lambda, or the function a deferred call gives, doesn't fit a sendable function
 * type, each capture of a type that isn't sendable is reported where it is captured, rather than
 * the two function types: a variable where the function first uses it, a value computed now at the
 * operand computing it. A captured `let` of a sendable type is a cell, which only the two types
 * explain.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { isSendable } from '../../types/traits/sendable.ts';
import { isSendableFunction } from '../../types/type/function-types.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';

/**
 * Reports each value the closure `node` captures that isn't sendable, where `expected` is a
 * sendable function; whether that explained why it doesn't fit there.
 */
export function explainedCaptures(context: BodyContext, node: Expression, expected: Type): boolean {
  const closure = unparenthesized(node);
  if (closure.kind !== 'Lambda' || expected.kind !== 'function' || !isSendableFunction(expected)) {
    return false;
  }
  const captures = context.functions.checkedOf(closure)?.captures ?? [];
  const unsendable = captures.filter(
    ({ type }) => type.kind !== 'error' && !isSendable(context.checker, type),
  );
  for (const { site, type } of unsendable) {
    const at = site.kind === 'Spread' ? site.expression : site;
    context.report(checkerDiagnostics.unsendableCapture(at.span, typeText(type)));
  }
  return unsendable.length > 0;
}
