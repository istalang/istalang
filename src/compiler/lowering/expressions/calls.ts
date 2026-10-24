/**
 * Calls (docs/arch/definition.md, "Calls"): every call targets the function-table entry of the
 * function the checker resolved for its site, operators and compound assignments included, so
 * this module is the one place lowering emits a `call`.
 *
 * An argument written `&x` passes the place `x`; a method's receiver is its first argument,
 * passed as a place when its `self` takes a reference (§3.7), which the `&` left implicit.
 */

import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import type { CallSite, ResolvedCall } from '../../checker/check.ts';
import type { Call, Expression, Spread } from '../../syntax/expressions.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';
import { placeOf } from '../places.ts';

export function lowerCall(context: FunctionContext, node: Call): Register {
  const resolved = resolvedAt(context, node);
  const written: readonly (Expression | Spread)[] =
    resolved.receiver === undefined ? node.arguments : [resolved.receiver, ...node.arguments];
  const parameters = context.checker.parametersOf(resolved.function);
  const argumentList = written.map((argument, index) =>
    argumentOf(context, argument, parameters[index]?.reference === true),
  );
  return emitCall(context, node, argumentList, context.code.allocate());
}

/** Calls the function the checker resolved for `site` with values; the register of its result. */
export function call(
  context: FunctionContext,
  site: CallSite,
  argumentRegisters: readonly Register[],
  dst: Register = context.code.allocate(),
): Register {
  const argumentList = argumentRegisters.map((register): Argument => ({ kind: 'value', register }));
  return emitCall(context, site, argumentList, dst);
}

function emitCall(
  context: FunctionContext,
  site: CallSite,
  argumentList: readonly Argument[],
  dst: Register,
): Register {
  context.code.emit({
    kind: 'call',
    span: site.span,
    dst,
    callee: { kind: 'function', function: context.calleeIndex(site) },
    arguments: [...argumentList],
  });
  return dst;
}

/** How `argument` is passed: the place `&x` names, the receiver's place for a `&self`, or a value. */
function argumentOf(
  context: FunctionContext,
  argument: Expression | Spread,
  byReference: boolean,
): Argument {
  if (argument.kind === 'Spread') {
    return notLowered(context, argument);
  }
  if (argument.kind === 'Reference') {
    return { kind: 'reference', place: placeOf(context, argument.expression) };
  }
  if (byReference) {
    return { kind: 'reference', place: placeOf(context, argument) };
  }
  return { kind: 'value', register: context.expression(argument) };
}

function resolvedAt(context: FunctionContext, site: CallSite): ResolvedCall {
  const resolved = context.body.calls.get(site);
  if (resolved === undefined) {
    throw new Error(`No call was resolved at ${site.span.start}.`);
  }
  return resolved;
}
