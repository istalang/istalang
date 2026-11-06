/**
 * Operations on an operand with no value (§2): a value of type `Never` can't exist, so it stands
 * only in code that never runs, and an operation that reaches its target through it — a member
 * read, a method or value call, an index, an operator (a compound assignment's too), a template, a
 * comparison, `await`, `?`, `->`, an optional step, a field loop or a pattern over it — never runs
 * either. Such an operation is checked no further and gives `Never`, reporting nothing, so a field
 * loop over a struct with no field checks its body once for the mistakes that don't depend on a
 * field. Its operands still run in order up to that one, which lowering reads
 * (`CheckedBody.stopsAt`).
 *
 * The error type stops an operation alike, a diagnostic having explained it, and gives the error
 * type: the two stay apart, one meaning "explained", the other "no value", and only the first
 * stopping operand in evaluation order decides which.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Assignment } from '../../syntax/statements/index.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import type { Type } from '../types/type/index.ts';
import { errorType, isPrimitive, neverType } from '../types/type/primitives.ts';

/** An operand of an operation, in evaluation order, and its type. */
export interface StoppingOperand {
  readonly node: Expression;
  readonly type: Type;
}

/**
 * What `operation` gives when one of its `operands`, in evaluation order, stops it: `Never` after
 * one with no value, recording the operands that run, or the error type after an explained one;
 * undefined when every operand has a value to work on.
 */
export function stoppedOperation(
  context: BodyContext,
  operation: Expression | Assignment,
  operands: readonly StoppingOperand[],
): Type | undefined {
  const index = operands.findIndex(
    ({ type }) => type.kind === 'error' || isPrimitive(type, 'Never'),
  );
  const stopping = operands[index];
  if (stopping === undefined) {
    return undefined;
  }
  if (stopping.type.kind === 'error') {
    return errorType;
  }
  context.stopAt(
    operation,
    operands.slice(0, index + 1).map(({ node }) => node),
  );
  return neverType;
}
