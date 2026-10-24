/**
 * Operators as calls (§3.9): `a + b` calls `add(a, b)`, and the four comparisons all call one
 * `compare`. The table below is the one place that says which function an operator means.
 *
 * An operator's function is found like any call's: by its name where the operator is written, the
 * prelude's included, which declares the operators on primitives as externs; through the modules
 * of the operands' types (§3.13); and among the requirements of the type parameters the operands
 * mention (§3.10).
 */

import type { Expression } from '../../syntax/expressions.ts';
import type { CallSite } from '../check.ts';
import type { BodyContext } from '../context.ts';
import type { Type } from '../types/type.ts';
import { topLevelCandidates } from './candidates.ts';
import { resolveCall } from './resolve.ts';

/** The function each overloadable operator calls (§3.9). */
export const operatorFunctions = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '//': 'floorDivide',
  '%': 'remainder',
  '<': 'compare',
  '<=': 'compare',
  '>': 'compare',
  '>=': 'compare',
  negate: 'negate',
} as const;

export type OverloadableOperator = keyof typeof operatorFunctions;

/** An operand: the expression written, and its type. */
export interface Operand {
  readonly node: Expression;
  readonly type: Type;
}

/**
 * Resolves `operator` applied to `operands` at `site`, recording the call; its result type, or
 * the error type after reporting that no single function takes those operands.
 */
export function resolveOperator(
  context: BodyContext,
  site: CallSite,
  operator: OverloadableOperator,
  operands: readonly Operand[],
): Type {
  const name = operatorFunctions[operator];
  const types = operands.map(({ type }) => type);
  return resolveCall(context, {
    site,
    name: operator === 'negate' ? '-' : operator,
    candidates: topLevelCandidates(context.checker, context.module, name, types),
    arguments: operands.map((operand) => ({ ...operand, passing: 'value' })),
    typeArguments: undefined,
    expected: undefined,
    form: 'operator',
  });
}
