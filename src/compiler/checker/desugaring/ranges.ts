/**
 * Ranges (§3.8), each the prelude's `Range` it builds: `a..b by s` is `Range{start: a, end: b,
 * step: s}`, an open side `none` and a missing step 1; `a..=b by s` is `_inclusiveRange(a, b, s)`,
 * which stores the end one past the written one in the step's direction, so every range is
 * half-open. Both take the operands in the order written.
 *
 * - Every operand is an `Int`, checked so before the core reads it, though the core's fields and
 *   parameters take `Int?` for the sides an open range leaves out: `x..5` with an `x: Int?` is
 *   refused as written.
 * - `Range` and `_inclusiveRange` are the prelude's, whatever a local name shadows (§3.4).
 */

import { inclusiveRangeFunction } from '../../../foundation/language/well-known/implicit-calls.ts';
import {
  languageModules,
  type WellKnownDeclaration,
  wellKnown,
} from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import type {
  Expression,
  FieldInitializer,
  Range,
  StructLiteral,
} from '../../syntax/expressions/index.ts';
import { endOf, startOf } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { bound, type Origin, synthesized } from '../contexts/synthesized.ts';
import { intType } from '../types/type/primitives.ts';
import type { Desugar } from './index.ts';

export const ranges: Desugar<Range> = {
  core: (context, node) => {
    for (const operand of [node.start, node.end, node.step]) {
      if (operand !== undefined) {
        context.sugars.operand(context, operand, intType);
      }
    }
    const origin = { sugar: node, role: 'range' };
    const start = node.start ?? none(origin, startOf(node.span));
    const step =
      node.step ??
      synthesized(origin, { kind: 'IntegerLiteral', span: endOf(node.span), value: 1n } as const);
    if (node.isInclusive && node.end !== undefined) {
      return synthesized(origin, {
        kind: 'Call',
        span: node.span,
        callee: preludeName(context, origin, {
          module: languageModules.prelude,
          name: inclusiveRangeFunction,
        }),
        isOptional: false,
        arguments: [start, node.end, step],
      } satisfies Call);
    }
    const end = node.end ?? none(origin, endOf(node.span));
    return synthesized(origin, {
      kind: 'StructLiteral',
      span: node.span,
      type: synthesized(origin, {
        kind: 'NamedType',
        span: node.span,
        path: [preludeName(context, origin, wellKnown.range)],
        typeArguments: [],
      } as const),
      items: [
        field(origin, 'start', start),
        field(origin, 'end', end),
        field(origin, 'step', step),
      ],
    } satisfies StructLiteral);
  },
  wording: {},
};

/** `name: value`, a field of the range built, at `value`. */
function field(origin: Origin, name: string, value: Expression): FieldInitializer {
  const { span } = value;
  const key = synthesized(origin, { kind: 'Identifier', span, text: name } as const);
  return synthesized(origin, { kind: 'FieldInitializer', span, name: key, value });
}

/** A name standing for `declaration`, bound to it. */
function preludeName(context: BodyContext, origin: Origin, declaration: WellKnownDeclaration) {
  const entity =
    context.checker.wellKnownEntity(declaration) ??
    unreachable(`The prelude declares '${declaration.name}'.`);
  const name = { kind: 'Identifier', span: origin.sugar.span, text: declaration.name } as const;
  return bound(synthesized(origin, name), entity);
}

/** `none`, an open side of a range, at `span`. */
function none(origin: Origin, span: Range['span']): Expression {
  return synthesized(origin, { kind: 'NoneLiteral', span } as const);
}
