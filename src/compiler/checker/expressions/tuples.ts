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

import type { Tuple, TupleElement } from '../../syntax/expressions/index.ts';
import { takePrechecked } from '../calls/lambda-arguments.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Accepts } from '../resolution/choice.ts';
import { acceptedPart, partsAccept } from '../rules/agreement.ts';
import { withoutOptionals } from '../types/fit.ts';
import { insideOptional } from '../types/inside-optional.ts';
import { errorType, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkTuple(context: BodyContext, node: Tuple, expected: Type | undefined): Type {
  if (node.elements.length === 0) {
    return unitType;
  }
  const target =
    expected === undefined ? undefined : withoutOptionals(expected, context.checker.optionalEntity);
  const guides =
    target?.kind === 'tuple' && target.elements.length === node.elements.length
      ? target.elements
      : undefined;
  return {
    kind: 'tuple',
    elements: node.elements.map((element, index) => {
      const guide = guides?.[index];
      const type = takePrechecked(element) ?? context.expression(element, guide);
      if (guide === undefined || context.checker.fitOf(type, guide) === undefined) {
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
    context.report(
      insideOptional(context.checker, node.target.span, type, '?.') ??
        checkerDiagnostics.notTuple(node.target.span, typeText(type)),
    );
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
  const elements = partsAccept(
    context,
    node.elements.map((element) => acceptedPart(context, element)),
  );
  if (elements === undefined) {
    return undefined;
  }
  return (expected, isOpen) => {
    const target = withoutOptionals(expected, context.checker.optionalEntity);
    return (
      target.kind === 'tuple' &&
      target.elements.length === elements.length &&
      target.elements.every((type, index) => elements[index]?.(type, isOpen) ?? true)
    );
  };
}
