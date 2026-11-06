/**
 * Tuples (§3.15): `(a, b)` builds one, `()` is `Unit`, and `t.0` reads an element by position,
 * also as a link of an optional chain (access/optionals.ts).
 *
 * An expected tuple of the same size guides each element, and an element that fits its guide,
 * by the implicit wrap into `T?` included (§2), takes the guide's type: `(1, none)` is an
 * `(Int?, Int?)` where one is expected. Whether the whole fits is the receiver's to judge, as for
 * any value, so an element that doesn't fit keeps its own type. A tuple holding an element a call
 * decides (§3.5) is decided with it; one whose elements each have a type of their own is built as
 * the parameter's type where they fit it and its own type doesn't (§3.7).
 */

import type { Tuple, TupleElement } from '../../../../syntax/expressions/index.ts';
import type { Accepts, BodyContext, PartReader } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import { partsAccept, partsBuild } from '../../../rules/agreement.ts';
import { expectedTuple } from '../../../types/fitting/expected.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, unitType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { insideOptional } from '../../../types/unions/inside-optional.ts';

export function checkTuple(context: BodyContext, node: Tuple, expected: Type | undefined): Type {
  if (node.elements.length === 0) {
    return unitType;
  }
  const guides = expectedTuple(expected, node.elements.length);
  return {
    kind: 'tuple',
    elements: node.elements.map((element, index) => {
      const guide = guides?.[index];
      const type = context.expression(element, guide);
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
  const stopped = stoppedOperation(context, node, [{ node: node.target, type }]);
  if (stopped !== undefined) {
    return stopped;
  }
  if (type.kind !== 'tuple') {
    context.report(
      insideOptional(node.target.span, type, '.') ??
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
  return tupleTaking(
    partsAccept(
      context,
      node.elements.map((element) => context.acceptedPart(element)),
    ),
  );
}

/**
 * Which tuple types `node`, of elements each with a type of its own as `read` reads them, can be
 * built as instead of its own (§3.7): its size, each element fitting its own.
 */
export function tupleBuilds(
  context: BodyContext,
  node: Tuple,
  read: PartReader,
): Accepts | undefined {
  return tupleTaking(
    partsBuild(
      context,
      node.elements.map((element) => read(element)),
    ),
  );
}

/** The tuple types of `elements`' size whose each element the element at its position takes. */
function tupleTaking(elements: readonly Accepts[] | undefined): Accepts | undefined {
  if (elements === undefined) {
    return undefined;
  }
  return (expected, isOpen) =>
    expectedTuple(expected, elements.length)?.every(
      (type, index) => elements[index]?.(type, isOpen) ?? true,
    ) === true;
}
