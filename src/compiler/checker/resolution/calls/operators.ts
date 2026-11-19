/**
 * Operators as calls (§10.2): `a + b` calls `add(a, b)`. Which function an operator calls is its
 * entry's in syntax/expressions/operators.ts; the orderings and `in`, which call `compare` and
 * `includes`, are the language's implicit calls (resolution/applying/implicit.ts).
 *
 * An operator's function is found like any call's: by its name where the operator is written, the
 * prelude's included, which declares the operators on primitives as externs; through the modules
 * of the operands' types (§13.1); and among the requirements of the type parameters the operands
 * mention (§8.2).
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  binaryOperators,
  type CallingBinaryOperator,
  type CallingUnaryOperator,
  type UnaryOperator,
  unaryOperators,
} from '../../../syntax/expressions/operators.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { ResolvedSite } from '../../surface/resolved-call.ts';
import type { Type } from '../../types/type/index.ts';
import { topLevelCandidates } from '../choosing/candidates.ts';
import { resolveCall } from './resolve/index.ts';

/** An operator a call site applies: as it is written, and the function it calls (§10.2). */
interface AppliedOperator {
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

/** An operand: the expression written, and its type. */
export interface Operand {
  readonly node: Expression;
  readonly type: Type;
}

/** An operator applied: where, what it applies, to which operands, and what it is expected to give. */
export interface OperatorCall {
  readonly site: ResolvedSite;
  readonly operator: AppliedOperator;
  readonly operands: readonly Operand[];
  readonly expected?: Type | undefined;
}

/**
 * Resolves `call`, recording it, its result advised by the type expected of it as a call's is; its
 * result type, or the error type after reporting that no single function takes its operands.
 */
export function resolveOperator(
  context: BodyContext,
  { site, operator, operands, expected }: OperatorCall,
): Type {
  const types = operands.map(({ type }) => type);
  return resolveCall(context, {
    site,
    name: operator.spelling,
    candidates: topLevelCandidates(context.checker, context.module, operator.function, types),
    arguments: operands.map((operand) => ({ ...operand, passing: 'value' })),
    typeArguments: undefined,
    expected,
    form: 'operator',
  });
}
