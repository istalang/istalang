/**
 * Calls (docs/arch/definition.md, "Calls"): every call targets the function-table entry of the
 * function the checker resolved for its site, operators and compound assignments included, so
 * this module is the one place lowering emits a `call`.
 */

import type { Register } from '../../../definition/operands.ts';
import type { CallSite } from '../../checker/check.ts';
import type { Call } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';

export function lowerCall(context: FunctionContext, node: Call): Register {
  const argumentRegisters = node.arguments.map((argument) =>
    argument.kind === 'Spread' ? notLowered(context, argument) : context.expression(argument),
  );
  return call(context, node, argumentRegisters);
}

/** Calls the function the checker resolved for `site`; the register holding the result. */
export function call(
  context: FunctionContext,
  site: CallSite,
  argumentRegisters: readonly Register[],
  dst: Register = context.code.allocate(),
): Register {
  context.code.emit({
    kind: 'call',
    span: site.span,
    dst,
    callee: { kind: 'function', function: context.calleeIndex(site) },
    arguments: argumentRegisters.map((register) => ({ kind: 'value', register })),
  });
  return dst;
}
