/**
 * A plain function value made async where an async function is expected (§3.14): a closure
 * capturing the plain value, whose entry is async and calls it with the arguments it is given. So
 * calling the closure starts an async function that returns at once, which gives a future already
 * resolved, and never suspends. The entry is one per site in a body's instance, so a trace through
 * it points at where the value was made async.
 */

import type { CodeFunction } from '../../definition/functions.ts';
import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { CodeContext } from './context.ts';
import { emitCall } from './emit-call.ts';
import type { AsyncFit } from './instances.ts';
import { SynthesizedCode } from './synthesized-code.ts';

/** `value`, the plain function `fit` makes async: a closure of its fit's entry. */
export function madeAsync(context: CodeContext, fit: AsyncFit, value: Register): Register {
  const dst = context.code.allocate();
  const entry = context.tables.asyncFitIndex(fit);
  const { span } = fit.site;
  context.code.emit({ kind: 'closure', span, dst, function: entry, captures: [value] });
  return dst;
}

/** The async entry of `fit`: it calls the value it captures with its own arguments. */
export function asyncFitEntry(
  context: Pick<CodeContext, 'checker' | 'tables'>,
  fit: AsyncFit,
): CodeFunction {
  const references = fit.type.parameters.map((parameter) => parameter.reference);
  const code = new SynthesizedCode(context, fit.site.span, references.length, 1);
  const [plain] = code.captures;
  if (plain === undefined) {
    unreachable('An async fit captures the function it calls.');
  }
  const result = emitCall(code, {
    span: code.span,
    callee: { kind: 'value', register: plain },
    arguments: code.parameters.map((_, index) => code.passedOn(index, references)),
  });
  code.return(result);
  return code.entry(context.tables.asyncFitHeader(fit), true, references);
}
