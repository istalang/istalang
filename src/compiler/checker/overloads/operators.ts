/**
 * Operators as calls (§3.9): `a + b` calls `add(a, b)`, and the four comparisons all call one
 * `compare`. The table below is the one place that says which function an operator means.
 *
 * On primitives the operators are built in: the prelude declares them as externs, such as
 * `add(int, float) -> float`, so they resolve like any other call. Finding operator functions
 * declared elsewhere (in scope, or in the modules of the operands' types) extends `candidates`.
 */

import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { CallSite } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { resolveOverload, typesText } from './resolve.ts';

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

/**
 * Resolves `operator` applied to `operands` at `site`, recording the call; its result type, or
 * the error type after reporting that no single overload takes those operands.
 */
export function resolveOperator(
  context: BodyContext,
  site: CallSite,
  operator: OverloadableOperator,
  operands: readonly Type[],
): Type {
  const written = operator === 'negate' ? '-' : operator;
  const request = { site, candidates: candidates(context, operator), argumentTypes: operands };
  return resolveOverload(context, request, (failure) => {
    context.report(
      failure === 'several'
        ? checkerDiagnostics.ambiguousCall(site.span, written, typesText(operands))
        : checkerDiagnostics.operatorTypes(
            site.span,
            written,
            operands.map(typeText).join(' and '),
          ),
    );
  });
}

function candidates(
  context: BodyContext,
  operator: OverloadableOperator,
): readonly FunctionDeclaration[] {
  return context.checker.preludeFunctions(operatorFunctions[operator]);
}
