/**
 * Tuples (§3.15): `()` is the unit constant, any other tuple a `tuple` instruction, and `t.0` a
 * `field` read by position, the instruction that reads struct fields too.
 */

import type { Register } from '../../../../../definition/operands.ts';
import type { Tuple, TupleElement } from '../../../../syntax/expressions/index.ts';
import type { FunctionContext } from '../../../context.ts';
import { tupleOf } from '../../../values/struct-values.ts';

export function lowerTuple(context: FunctionContext, node: Tuple): Register {
  const elements = node.elements.map((element) => context.expression(element));
  return tupleOf(context, elements, node.span);
}

export function lowerTupleElement(context: FunctionContext, node: TupleElement): Register {
  const target = context.chains.target(context, node);
  return context.code.field(target, node.element, node.span);
}
