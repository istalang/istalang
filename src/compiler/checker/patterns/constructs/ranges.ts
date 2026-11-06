/**
 * Range patterns (§3.11): a range compares its `Int` part with each bound it has, through the
 * `compare` made at that bound, and acts as a guard for exhaustiveness; an empty range is reported.
 */

import { signedNumberOf } from '../../../syntax/expressions/numbers.ts';
import { binaryOperators, type Relation } from '../../../syntax/operators.ts';
import type { LiteralPattern, RangePattern } from '../../../syntax/patterns.ts';
import type { BodyContext } from '../../body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { preludeCall } from '../../resolution/implicit.ts';
import type { PatternTest } from '../../surface/checked-pattern.ts';
import { intType, isPrimitive } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type-text.ts';
import type { ValuePart } from '../parts.ts';
import { failed, type Leaf } from '../pattern-tests.ts';

/** The leaf of the range pattern `node` against `part`. */
export function rangeLeaf(context: BodyContext, node: RangePattern, part: ValuePart): Leaf {
  const bounds = [node.start, node.end].flatMap((bound) => (bound === undefined ? [] : [bound]));
  const types = bounds.map((bound) => context.expression(bound.value, intType));
  if (part.type.kind === 'error' || types.some((type) => type.kind === 'error')) {
    return failed;
  }
  const notInt = [part.type, ...types].find((type) => !isPrimitive(type, 'Int'));
  if (notInt !== undefined) {
    context.report(checkerDiagnostics.notIntRangePattern(node.span, typeText(notInt)));
    return failed;
  }
  const [start, end] = [node.start, node.end].map((bound) => bound && intValueOf(bound));
  const empty =
    start !== undefined && end !== undefined && (node.isInclusive ? start > end : start >= end);
  if (empty) {
    context.report(checkerDiagnostics.emptyRangePattern(node.span));
  }
  for (const bound of bounds) {
    preludeCall(context, {
      node: bound,
      role: 'compare',
      name: compareFunction,
      arguments: [intType, intType],
    });
  }
  const test = (bound: LiteralPattern, relation: Relation): PatternTest => ({
    kind: 'compare',
    path: part.path,
    site: bound,
    value: { kind: 'expression', node: bound.value },
    relation,
  });
  const tests = [
    ...(node.start === undefined ? [] : [test(node.start, 'greaterOrEqual')]),
    ...(node.end === undefined ? [] : [test(node.end, node.isInclusive ? 'lessOrEqual' : 'less')]),
  ];
  return { tests, shape: undefined };
}

/** The int a range pattern's bound writes: a literal, negated or not (the parser allows no other). */
function intValueOf(bound: LiteralPattern): bigint | undefined {
  const number = signedNumberOf(bound.value);
  return number?.kind === 'IntegerLiteral' ? number.value : undefined;
}

/** The function every ordering calls (§3.9). */
export const compareFunction = binaryOperators['<'].meaning.function;
