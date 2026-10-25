/**
 * Tuples (§3.15): `(a, b)` builds one, `()` is `unit`, and `t.0` reads an element by position,
 * also as a link of an optional chain (optionals.ts).
 *
 * An expected tuple of the same size guides each element, so an element is inferred as its
 * position expects; whether the whole fits is the receiver's to judge, as for any value.
 */

import type { Tuple, TupleElement } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { errorType, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkTuple(context: BodyContext, node: Tuple, expected: Type | undefined): Type {
  if (node.elements.length === 0) {
    return unitType;
  }
  const guides =
    expected?.kind === 'tuple' && expected.elements.length === node.elements.length
      ? expected.elements
      : undefined;
  return {
    kind: 'tuple',
    elements: node.elements.map((element, index) => context.expression(element, guides?.[index])),
  };
}

export function checkTupleElement(context: BodyContext, node: TupleElement): Type {
  const type = context.chains.target(context, node);
  if (type.kind === 'error') {
    return errorType;
  }
  if (type.kind !== 'tuple') {
    context.report(checkerDiagnostics.notTuple(node.target.span, typeText(type)));
    return errorType;
  }
  const element = type.elements[node.element];
  if (element === undefined) {
    context.report(checkerDiagnostics.noTupleElement(node.span, typeText(type), node.element));
    return errorType;
  }
  return element;
}
