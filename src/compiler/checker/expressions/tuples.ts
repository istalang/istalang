/**
 * Tuples (§3.15): `(a, b)` builds one, `()` is `unit`, and `t.0` reads an element by position,
 * also as a link of an optional chain (optionals.ts).
 *
 * An expected tuple of the same size guides each element, and an element that fits its guide,
 * by the implicit wrap into `T?` included (§2), takes the guide's type: `(1, none)` is an
 * `(int?, int?)` where one is expected. Whether the whole fits is the receiver's to judge, as for
 * any value, so an element that doesn't fit keeps its own type. A tuple holding an element a call
 * decides (§3.5) is decided with it.
 */

import type { Tuple, TupleElement } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Accepts } from '../resolution/choice.ts';
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
    elements: node.elements.map((element, index) => {
      const guide = guides?.[index];
      const type = context.expression(element, guide);
      if (guide === undefined || context.checker.wrapsToFit(type, guide) === undefined) {
        return type;
      }
      context.fit(type, guide, element);
      return guide;
    }),
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

/** Which tuple types `node` can take: its size, each element taking its own, if one has none. */
export function tupleAccepts(context: BodyContext, node: Tuple): Accepts | undefined {
  const elements = node.elements.map((element) => context.accepts(element));
  if (elements.every((accepts) => accepts === undefined)) {
    return undefined;
  }
  return (expected, isOpen) =>
    expected.kind === 'tuple' &&
    expected.elements.length === elements.length &&
    expected.elements.every((type, index) => elements[index]?.(type, isOpen) ?? true);
}
