/**
 * Calls (docs/arch/definition.md, "Calls"): every call targets the function-table entry of the
 * function the checker resolved for its site, operators and compound assignments included, or the
 * one it made for a construct with no call written (indexing writes, loops, map literals of other
 * types). Every call is written by emit-call.ts.
 *
 * An argument written `&x` passes the place `x`; a method's receiver is its first argument,
 * passed as a place when its `self` takes a reference (§3.7), which the `&` left implicit.
 */

import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import type { CallSite, ImplicitRole, ResolvedCall } from '../../checker/check.ts';
import type { Call, Expression, Spread } from '../../syntax/expressions.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
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
  return emitCall(context, {
    span: node.span,
    callee: context.calleeIndex(node),
    arguments: argumentList,
  });
}

/** Calls the function the checker resolved for `site` with values; the register of its result. */
export function call(
  context: FunctionContext,
  site: CallSite,
  argumentRegisters: readonly Register[],
  dst: Register = context.code.allocate(),
): Register {
  return emitCall(
    context,
    { span: site.span, callee: context.calleeIndex(site), arguments: argumentRegisters },
    dst,
  );
}

/**
 * Calls the function the checker made for `node` in `role`, a call no source call stands for
 * (checker overloads/implicit.ts); a register argument is passed by value. The register of its
 * result.
 */
export function implicitCall(
  context: FunctionContext,
  node: NodeOf<string>,
  role: ImplicitRole,
  argumentList: readonly (Register | Argument)[],
): Register {
  const callee = context.implicitCallee(node, role);
  return emitCall(context, { span: node.span, callee, arguments: argumentList });
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
