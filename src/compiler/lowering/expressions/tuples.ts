/**
 * Tuples (§3.15): `()` is the unit constant, any other tuple a `tuple` instruction, and `t.0` a
 * `field` read by position, the instruction that reads struct fields too.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Tuple, TupleElement } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { readPart } from '../places.ts';

export function lowerTuple(context: FunctionContext, node: Tuple): Register {
  if (node.elements.length === 0) {
    return context.constant(null, node.span);
  }
  const elements = node.elements.map((element) => context.expression(element));
  const dst = context.code.allocate();
  context.code.emit({ kind: 'tuple', span: node.span, dst, elements });
  return dst;
}

export function lowerTupleElement(context: FunctionContext, node: TupleElement): Register {
  return readPart(context, context.expression(node.target), [node.element], node.span);
}
