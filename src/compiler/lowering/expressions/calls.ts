/**
 * Calls (docs/arch/definition.md, "Calls"): every call targets the function-table entry of the
 * function the checker resolved for its site, operators and compound assignments included, or the
 * one it made for a construct with no call written (indexing writes, loops, map literals of other
 * types). Every call is written by emit-call.ts.
 *
 * An argument written `&x` passes the place `x`; a method's receiver is its first argument,
 * passed as a place when its `self` takes a reference (§3.7), which the `&` left implicit. A place
 * reached through an element or a `x$` is copied in before the call and written back after it
 * (places.ts).
 *
 * A call the checker resolved no function for is a call of a function value (§3.14): the callee's
 * value is the closure called, and each argument is passed as written, which the checker matched
 * to the closure's parameters.
 */

import type { Callee } from '../../../definition/instructions/calls.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import type { CallSite, ImplicitRole, ResolvedCall } from '../../checker/check.ts';
import {
  type Call,
  type Expression,
  type Spread,
  unparenthesized,
} from '../../syntax/expressions.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { Spawn } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { emitCall } from '../emit-call.ts';
import { notLowered } from '../not-lowered.ts';
import { enterReferenced } from '../places.ts';
import { lowerOwnCall } from './own-calls.ts';
import { lowerFieldRead } from './structs.ts';

export function lowerCall(context: FunctionContext, node: Call): Register {
  const watched = context.body.watchedCallOf(node);
  if (watched !== undefined) {
    return lowerOwnCall(context, node, watched);
  }
  const resolved = context.body.calls.get(node);
  if (resolved === undefined) {
    return lowerValueCall(context, node);
  }
  const parameters = context.checker.parametersOf(resolved.function);
  const receiver = receiverOf(context, node, resolved, parameters[0]?.reference === true);
  const passed = node.arguments.map((argument, index) => {
    const at = receiver === undefined ? index : index + 1;
    return argumentOf(context, argument, parameters[at]?.reference === true);
  });
  const argumentList = receiver === undefined ? passed : [receiver, ...passed];
  const dst = emitCall(context, {
    span: node.span,
    callee: context.calleeIndex(node),
    arguments: argumentList.map(({ argument }) => argument),
  });
  leaveAll(argumentList);
  return dst;
}

/**
 * A method's receiver as its first argument (§3.7); through an optional chain, the value the
 * chain carries, which the checker passes only by value (§4).
 */
function receiverOf(
  context: FunctionContext,
  node: Call,
  resolved: ResolvedCall,
  byReference: boolean,
): PassedArgument | undefined {
  const { receiver } = resolved;
  if (receiver === undefined) {
    return undefined;
  }
  if (context.body.chainOf(node) === undefined) {
    return argumentOf(context, receiver, byReference);
  }
  return { argument: { kind: 'value', register: context.chains.target(context, node) } };
}

/**
 * A call of the function value `node.callee` evaluates to. A field's, `x.f(…)`, is read from the
 * value the call works on, since the call, not the access, is the link of an optional chain.
 */
function lowerValueCall(context: FunctionContext, node: Call): Register {
  const callee = valueCallee(context, node);
  const argumentList = node.arguments.map((argument) => argumentOf(context, argument, false));
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'call',
    span: node.span,
    dst,
    callee: { kind: 'value', register: callee },
    arguments: argumentList.map(({ argument }) => argument),
  });
  leaveAll(argumentList);
  return dst;
}

/** The function value a call of no resolved function calls. */
function valueCallee(context: FunctionContext, node: Call): Register {
  return node.callee.kind === 'MemberAccess'
    ? lowerFieldRead(context, node.callee, node)
    : context.expression(node.callee);
}

/**
 * `spawn f(args)` (§9): what the call would run, the function the checker resolved or the value of
 * a sendable function type, and its arguments, a method's receiver first, all by value.
 */
export function lowerSpawn(context: FunctionContext, node: Spawn): void {
  const spawned = unparenthesized(node.call);
  if (spawned.kind !== 'Call') {
    throw new Error('A spawn of no call checked clean.');
  }
  const resolved = context.body.calls.get(spawned);
  const callee: Callee =
    resolved === undefined
      ? { kind: 'value', register: valueCallee(context, spawned) }
      : { kind: 'function', function: context.calleeIndex(spawned) };
  const receiver = resolved?.receiver;
  const copied = receiver === undefined ? spawned.arguments : [receiver, ...spawned.arguments];
  context.code.emit({
    kind: 'spawn',
    span: node.span,
    callee,
    arguments: copied.map((argument) =>
      argument.kind === 'Spread' ? notLowered(context, argument) : context.expression(argument),
    ),
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

/** An argument as the call passes it, and for a place copied in, how it is written back. */
interface PassedArgument {
  readonly argument: Argument;
  readonly leave?: () => void;
}

/** How `argument` is passed: the place `&x` names, the receiver's place for a `&self`, or a value. */
function argumentOf(
  context: FunctionContext,
  argument: Expression | Spread,
  byReference: boolean,
): PassedArgument {
  if (argument.kind === 'Spread') {
    return { argument: notLowered(context, argument) };
  }
  const place = referencedPlace(argument, byReference);
  if (place === undefined) {
    return { argument: { kind: 'value', register: context.expression(argument) } };
  }
  const { target, leave } = enterReferenced(context, place);
  return { argument: { kind: 'reference', place: target.place }, leave };
}

/** The place an argument passes by `&`: written `&x`, or a receiver taken as `&self`. */
function referencedPlace(argument: Expression, byReference: boolean): Expression | undefined {
  if (argument.kind === 'Reference') {
    return argument.expression;
  }
  return byReference ? argument : undefined;
}

/** Writes back what the call's arguments copied in, the last first. */
function leaveAll(argumentList: readonly PassedArgument[]): void {
  for (const { leave } of argumentList.toReversed()) {
    leave?.();
  }
}
