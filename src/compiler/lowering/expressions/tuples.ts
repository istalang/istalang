/**
 * Tuples (§3.15): `()` is the unit constant, any other tuple a `tuple` instruction, and `t.0` a
 * `field` read by position, the instruction that reads struct fields too.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { Tuple, TupleElement } from '../../syntax/expressions/index.ts';
import type { FunctionContext } from '../context.ts';
import { readPart } from '../places.ts';

export function lowerTuple(context: FunctionContext, node: Tuple): Register {
  const elements = node.elements.map((element) => context.expression(element));
  return tupleOf(context, elements, node.span);
}

/** The tuple of `elements`' values: the unit constant of none (§3.15). */
export function tupleOf(
  context: FunctionContext,
  elements: readonly Register[],
  span: Span,
): Register {
  if (elements.length === 0) {
    return context.constant(null, span);
  }
  const dst = context.code.allocate();
  context.code.emit({ kind: 'tuple', span, dst, elements: [...elements] });
  return dst;
}

export function lowerTupleElement(context: FunctionContext, node: TupleElement): Register {
  const target = context.chains.target(context, node);
  return readPart(context, target, [node.element], node.span);
}
