/**
 * A chain of comparisons, `a < b <= c` (§3.9), is its links joined by `and`, each operand computed
 * once, in order, and none after a link that fails:
 * `{ const a' = a; const b' = b; a' < b' and { const c' = c; b' <= c' and c' < d } }`.
 *
 * - Each link is a comparison of its own, checked, decided and lowered as one written alone, so a
 *   chain has no rule of its own; an operand shared by two links is a constant each reads.
 * - The last operand is read once, so it is compared where it is written, held in no constant.
 * - A link stands where its operands are written, so what is reported of it points at them.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Binary, ChainedComparison, Expression } from '../../syntax/expressions/index.ts';
import type { ChainingOperator } from '../../syntax/expressions/operators.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { spanAcross } from '../../syntax/tree/positions.ts';
import { type Origin, synthesized } from '../contexts/synthesized.ts';
import type { CoreExpression } from '../surface/checked-body.ts';
import { afterConstants, type HeldConstant, heldConstant } from './constants.ts';
import type { Desugar } from './index.ts';

/** A chain being desugared, and what its core's nodes are built as. */
interface Linking {
  readonly chain: ChainedComparison;
  readonly origin: Origin;
}

export const chainedComparisons: Desugar<ChainedComparison> = {
  core: (_context, chain) => {
    const linking = { chain, origin: { sugar: chain, role: 'link' } };
    const first = operandAt(chain, 0);
    const held = heldConstant(first, first.span, linking.origin);
    return linksFrom(linking, 0, held, [held.declaration]);
  },
  wording: {},
};

/**
 * The links of `chain` from the one at `index` on, its left operand held in `left`, computed after
 * `constants`: that link, and when it holds, the rest.
 */
function linksFrom(
  linking: Linking,
  index: number,
  left: HeldConstant,
  constants: readonly VariableDeclaration[],
): CoreExpression {
  const { chain, origin } = linking;
  const operator = chain.operators[index] ?? unreachable('A link has an operator.');
  const operand = operandAt(chain, index + 1);
  if (index === chain.operators.length - 1) {
    const last = link(origin, left.read(origin), operator, operand);
    return withConstants(linking, constants, last);
  }
  const right = heldConstant(operand, operand.span, origin);
  const holds = link(origin, left.read(origin), operator, right.read(origin));
  const rest = linksFrom(linking, index + 1, right, []);
  const both = link(origin, holds, 'and', rest);
  return withConstants(linking, [...constants, right.declaration], both);
}

/** `value` computed after `constants`, in a block from the first of them to `chain`'s end. */
function withConstants(
  { chain, origin }: Linking,
  constants: readonly VariableDeclaration[],
  value: CoreExpression,
): CoreExpression {
  const [first] = constants;
  return first === undefined
    ? value
    : afterConstants(constants, value, spanAcross(first.span, chain.span), origin);
}

/** `left operator right`, standing where its operands are written. */
function link(
  origin: Origin,
  left: Expression,
  operator: ChainingOperator | 'and',
  right: Expression,
): Binary {
  return synthesized(origin, {
    kind: 'Binary',
    span: spanAcross(left.span, right.span),
    left,
    operator,
    right,
  });
}

function operandAt(chain: ChainedComparison, index: number): Expression {
  return chain.operands[index] ?? unreachable('A chain has one more operand than operators.');
}
