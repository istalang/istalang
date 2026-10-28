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

import {
  type Expression,
  type Tuple,
  type TupleElement,
  unparenthesized,
} from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Accepts } from '../resolution/call-arguments.ts';
import { partsAccept } from '../rules/agreement.ts';
import { withoutOptionals } from '../types/fit.ts';
import { insideOptional } from '../types/inside-optional.ts';
import { errorType, type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** Per-element guides for a tuple value whose target tuple contains `_` gaps (`statements/assignments.ts`). */
export interface TupleGuide {
  readonly elements: readonly (Type | undefined | TupleGuide)[];
}

const activeGuides = new WeakMap<Expression, TupleGuide>();

/** Checks `compute` with `guide` guiding `value` when `value` is a tuple literal. */
export function withTupleGuide(
  value: Expression,
  guide: TupleGuide | undefined,
  compute: () => Type,
): Type {
  const bare = unparenthesized(value);
  if (guide === undefined) {
    return compute();
  }
  activeGuides.set(bare, guide);
  try {
    return compute();
  } finally {
    activeGuides.delete(bare);
  }
}

export function checkTuple(context: BodyContext, node: Tuple, expected: Type | undefined): Type {
  if (node.elements.length === 0) {
    return unitType;
  }
  const guides = expectedTuple(context, expected, node.elements.length);
  const partial =
    guides === undefined && expected === undefined ? activeGuides.get(node) : undefined;
  const partialElements =
    partial?.elements.length === node.elements.length ? partial.elements : undefined;
  return {
    kind: 'tuple',
    elements: node.elements.map((element, index) => {
      const slot = guides?.[index] ?? partialElements?.[index];
      const guide = slot !== undefined && 'kind' in slot ? slot : undefined;
      const nestedGuide = slot !== undefined && !('kind' in slot) ? slot : undefined;
      const type = withTupleGuide(element, nestedGuide, () => context.expression(element, guide));
      if (guide === undefined || context.checker.fitOf(type, guide) === undefined) {
        return type;
      }
      context.fit(type, guide, element);
      return guide;
    }),
  };
}

/** The element types `expected` asks a tuple of `length` elements for, through any optionals (§2). */
function expectedTuple(
  context: BodyContext,
  expected: Type | undefined,
  length: number,
): readonly Type[] | undefined {
  const target =
    expected === undefined ? undefined : withoutOptionals(expected, context.checker.optionalEntity);
  return target?.kind === 'tuple' && target.elements.length === length
    ? target.elements
    : undefined;
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
    node.elements.map((element) => context.acceptedPart(element)),
  );
  if (elements === undefined) {
    return undefined;
  }
  return (expected, isOpen) =>
    expectedTuple(context, expected, elements.length)?.every(
      (type, index) => elements[index]?.(type, isOpen) ?? true,
    ) === true;
}
