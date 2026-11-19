/**
 * Ranges (§19.3), each the prelude's `Range` it builds: `a..b by s` is `Range{start: a, end: b,
 * step: s}`, an open side `none` and a missing step 1; `a..=b by s` is `_inclusiveRange(a, b, s)`,
 * which stores the end one past the written one in the step's direction, so every range is
 * half-open. Both take the operands in the order written.
 *
 * - Every operand is an `Int`, checked so before the core reads it, though the core's fields and
 *   parameters take `Int?` for the sides an open range leaves out: `x..5` with an `x: Int?` is
 *   refused as written.
 * - `Range` and `_inclusiveRange` are the prelude's, whatever a local name shadows (§7.1).
 */

import { inclusiveRangeFunction } from '../../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import type { Expression, Range } from '../../syntax/expressions/index.ts';
import { endOf, startOf } from '../../syntax/tree/positions.ts';
import { type Origin, synthesized } from '../contexts/synthesized.ts';
import { intType } from '../types/type/primitives.ts';
import { callOf, preludeName } from './core-nodes.ts';
import type { Desugar } from './index.ts';

export const ranges: Desugar<Range> = {
  core: (context, node) => {
    for (const operand of [node.start, node.end, node.step]) {
      if (operand !== undefined) {
        context.sugars.operand(context, operand, intType);
      }
    }
    const origin = { sugar: node, role: 'range' };
    const { span } = node;
    const start = node.start ?? none(origin, startOf(span));
    const one = { kind: 'IntegerLiteral', span: endOf(span), value: 1n } as const;
    const step = node.step ?? synthesized(origin, one);
    if (node.isInclusive && node.end !== undefined) {
      const inclusive = preludeName(context, origin, inclusiveRangeFunction, span);
      return callOf(origin, span, inclusive, [start, node.end, step]);
    }
    const end = node.end ?? none(origin, endOf(span));
    const range = [preludeName(context, origin, wellKnown.range.name, span)] as const;
    const type = { kind: 'NamedType', span, path: range, typeArguments: [] } as const;
    const fields = Object.entries({ start, end, step }).map(([name, value]) => {
      const key = synthesized(origin, {
        kind: 'Identifier',
        span: value.span,
        text: name,
      } as const);
      return synthesized(origin, {
        kind: 'FieldInitializer',
        span: value.span,
        name: key,
        value,
      } as const);
    });
    return synthesized(origin, {
      kind: 'StructLiteral',
      span,
      type: synthesized(origin, type),
      items: fields,
    } as const);
  },
  wording: {},
};

/** `none`, an open side of a range, at `span`. */
function none(origin: Origin, span: Range['span']): Expression {
  return synthesized(origin, { kind: 'NoneLiteral', span } as const);
}
