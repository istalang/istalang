/**
 * Operators as calls (§3.9): `a + b` calls `add(a, b)`, and the four orderings all call one
 * `compare`. Which function an operator calls is its entry's in syntax/operators.ts.
 *
 * An operator's function is found like any call's: by its name where the operator is written, the
 * prelude's included, which declares the operators on primitives as externs; through the modules
 * of the operands' types (§3.13); and among the requirements of the type parameters the operands
 * mention (§3.10).
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  binaryOperators,
  type CallingBinaryOperator,
  type CallingUnaryOperator,
  type UnaryOperator,
  unaryOperators,
} from '../../syntax/operators.ts';
import type { BodyContext } from '../context.ts';
import { type FrontierConstruct, frontier } from '../frontier.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import type { CallSite } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';
import { resolveCall } from './resolve.ts';

/** An operator a call site applies: as it is written, and the function it calls (§3.9). */
export interface AppliedOperator {
  readonly spelling: BinaryOperator | UnaryOperator;
  readonly function: string;
}

/** What a binary operator that calls a function applies. */
export function binaryApplied(operator: CallingBinaryOperator): AppliedOperator {
  return applied(operator, binaryOperators[operator].meaning);
}

/** What a prefix operator that calls a function applies. */
export function unaryApplied(operator: CallingUnaryOperator): AppliedOperator {
  return applied(operator, unaryOperators[operator].meaning);
}

/** What `spelling` applies, given the function its meaning calls. */
export function applied(
  spelling: AppliedOperator['spelling'],
  meaning: { readonly function: string },
): AppliedOperator {
  return { spelling, function: meaning.function };
}

/** Operators parsed but not checked yet, each named as the frontier names it (frontier.ts). */
const notSupportedYet: Readonly<Partial<Record<AppliedOperator['spelling'], FrontierConstruct>>> = {
  '|': frontier.bitwiseOperator,
  '^': frontier.bitwiseOperator,
  '&': frontier.bitwiseOperator,
  '<<': frontier.bitwiseOperator,
  '>>': frontier.bitwiseOperator,
  '~': frontier.bitwiseOperator,
  '**': frontier.powerOperator,
};

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
  operator: AppliedOperator,
  operands: readonly Operand[],
): Type {
  const construct = notSupportedYet[operator.spelling];
  if (construct !== undefined) {
    return context.unsupported(site, construct);
  }
  const types = operands.map(({ type }) => type);
  return resolveCall(context, {
    site,
    name: operator.spelling,
    candidates: topLevelCandidates(context.checker, context.module, operator.function, types),
    arguments: operands.map((operand) => ({ ...operand, passing: 'value' })),
    typeArguments: undefined,
    expected: undefined,
    form: 'operator',
  });
}
