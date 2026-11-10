/**
 * Deferred calls, `g f(args)` (§3.14): `g` is given a function making the call `f(args)` later,
 * with everything written in it computed now, as `g((fn(x): fn(): f(x))(args))` would.
 *
 * - The call is checked here as any expression is, settled on its own, so its record is an
 *   ordinary call's and lowering reads what it computes now from it: its callee's value, or a
 *   method's receiver and the calls before the last, then every argument written, left to right.
 *   A deferred call within it computes its taker's parts now too, so `a b c(x)` computes `x` once,
 *   here; its own call it checks itself.
 * - The function takes nothing and gives what the call gives. It is sendable when every value it
 *   captures is, so where a sendable function is taken, each value that isn't is reported
 *   (resolution/calls/deferred-arguments.ts). It is built where it is given, so it is never fitted
 *   as a value is: the parameter it fills is recorded at the call (`Deferrals`), and lowering builds
 *   it as that type, giving what the call gives fitted to it.
 * - Nothing captured can be a reference, so a `&` argument, or a receiver its method takes by
 *   `&self`, is refused. A call in an optional chain may not happen at all, and a variant without
 *   fields is a value, so neither can be deferred.
 * - The taker is called as any callee is (calls.ts), the function given after the arguments its
 *   parentheses write, filling the parameter binding gives it (resolution/choosing/binding.ts). A
 *   taker that is a value but no function is likely an item before a missing comma, `[a b(c)]`, so
 *   that is reported, and what follows it is checked as a value of its own.
 * - A call that stops before it is made, its callee or receiver having no value, gives no
 *   function, as an argument with no value gives none (§2).
 */

import { argumentValue } from '../../../syntax/expressions/arguments.ts';
import type { CallingNode, DeferredCall } from '../../../syntax/expressions/calls.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import {
  calledName,
  deferredOf,
  qualifiedPath,
  writtenArgumentsOf,
} from '../../../syntax/expressions/readings.ts';
import { spanBetween } from '../../../syntax/tree/positions.ts';
import type { BodyContext, DeferralRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { unsendable } from '../../resolution/calls/deferred-arguments.ts';
import type { WrittenArgument } from '../../resolution/calls/resolve/index.ts';
import type { StoppingOperand } from '../../resolution/calls/stopped-operations.ts';
import { calledVariant } from '../../surface/named-variants.ts';
import { functionType } from '../../types/type/function-types.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, isPrimitive, neverType } from '../../types/type/primitives.ts';
import { calledValueType } from '../closures/value-calls.ts';
import { calledValue, checkCallMade } from './calls.ts';

/** What the function each deferred call in one body gives is given as, by the call it makes. */
export class Deferrals implements DeferralRecord {
  readonly #given: PassTable<Expression, Type>;

  constructor(passes: Passes) {
    this.#given = passes.table();
  }

  record(call: Expression, given: Type): void {
    this.#given.set(call, given);
  }

  of(call: Expression, pass?: Pass): Type | undefined {
    return this.#given.get(call, pass);
  }
}

export function checkDeferredCall(
  context: BodyContext,
  node: DeferredCall,
  expected: Type | undefined,
): Type {
  const value = calledValue(context, node);
  if (value?.type !== undefined && !mayBeCalled(value.type)) {
    return missingComma(context, node);
  }
  return checkCallMade(context, {
    node,
    expected,
    value,
    given: () => deferredFunction(context, node),
  });
}

/** Whether a value of `type` may be called, or has no type to say it can't. */
function mayBeCalled(type: Type): boolean {
  return type.kind === 'function' || type.kind === 'error' || isPrimitive(type, 'Never');
}

/**
 * `node` read as two items with no `,` between: what its taker's parentheses hold and what follows
 * it are checked as values of their own, and the missing comma is reported.
 */
function missingComma(context: BodyContext, node: DeferredCall): Type {
  for (const argument of writtenArgumentsOf(node)) {
    context.expression(argumentValue(argument));
  }
  context.expression(node.call);
  const taker = qualifiedPath(calledName(node))?.map(({ text }) => text) ?? [];
  context.report(
    checkerDiagnostics.missingComma(spanBetween(node.taker.span, node.call.span), taker.join('.')),
  );
  return errorType;
}

/**
 * The function `node` gives its taker, as an argument after those its parentheses write; of the
 * error type after a report, and of none where its call stops before it is made, binding as the
 * function all the same.
 */
function deferredFunction(context: BodyContext, node: DeferredCall): WrittenArgument {
  const given = (type: Type, captured: readonly StoppingOperand[] = []): WrittenArgument => ({
    node: node.call,
    passing: 'value',
    type,
    deferred: { node, computed: captured },
  });
  const deferred = deferredOf(node);
  if (deferred === undefined) {
    context.expression(node.call);
    context.report(checkerDiagnostics.deferredNeedsCall(node.call.span));
    return given(errorType);
  }
  const result = context.settled(node.call);
  if (result.kind === 'error') {
    return given(errorType);
  }
  if (context.callAt(deferred) === undefined && !context.valueCalls.has(deferred)) {
    return given(unmade(context, deferred));
  }
  if (refused(context, deferred)) {
    return given(errorType);
  }
  const computed = computedNow(context, deferred);
  const reach = unsendable(context, computed).length === 0 ? 'sendable' : 'plain';
  return given(functionType({ reach, parameters: [], result }), computed);
}

/**
 * What a call neither resolved nor of a function value gives the function deferring it: nothing,
 * after a stop (§2); a variant without fields is a value, refused.
 */
function unmade(context: BodyContext, call: CallingNode): Type {
  const variant = call.kind === 'Call' ? calledVariant(context, call)?.variant : undefined;
  if (variant === undefined) {
    return neverType;
  }
  const callee = `'${variant.name.text}'`;
  const why = 'a variant without fields is a value, not a function';
  context.report(checkerDiagnostics.notDeferrable(calledName(call).span, callee, why));
  return errorType;
}

/**
 * Whether what `call` computes itself, deferred, can't be captured, reporting each: a reference,
 * passed by `&` or as a `&self` receiver, or a link of an optional chain. A deferred call's own call
 * is its own check's to refuse.
 */
function refused(context: BodyContext, call: CallingNode): boolean {
  const references = writtenArgumentsOf(call)
    .map(argumentValue)
    .filter((argument) => argument.kind === 'Reference');
  const receiver = referencedReceiver(context, call);
  const captured = receiver === undefined ? references : [receiver, ...references];
  for (const { span } of captured) {
    context.report(checkerDiagnostics.deferredReference(span));
  }
  const chained = context.chains.chainOf(call) !== undefined;
  if (chained) {
    const why = 'whether it happens is known only when it runs';
    context.report(checkerDiagnostics.notDeferrable(call.span, 'A call in an optional chain', why));
  }
  return captured.length > 0 || chained;
}

/** The receiver `call` passes to a method taking `&self`, which it would capture (§3.7). */
function referencedReceiver(context: BodyContext, call: CallingNode): Expression | undefined {
  const resolved = context.callAt(call);
  const receiver = resolved?.receiver;
  if (resolved === undefined || receiver === undefined) {
    return undefined;
  }
  return context.checker.parametersOf(resolved.function)[0]?.reference === true
    ? receiver
    : undefined;
}

/**
 * What `call`, made later, computes now, in the order it runs, each with its type: its callee's
 * value or its receiver, then each argument its parentheses write; for a deferred call, then what
 * its own call computes now.
 */
function computedNow(context: BodyContext, call: CallingNode): readonly StoppingOperand[] {
  const written = writtenArgumentsOf(call).map((argument) => {
    const node = argumentValue(argument);
    return { node, type: context.typeOf(node) };
  });
  const own = [...calleeNow(context, call), ...written];
  const deferred = call.kind === 'DeferredCall' ? deferredOf(call) : undefined;
  return deferred === undefined ? own : [...own, ...computedNow(context, deferred)];
}

/** The value `call` calls, computed now: a function value, or a method's receiver; else none. */
function calleeNow(context: BodyContext, call: CallingNode): readonly StoppingOperand[] {
  if (context.valueCalls.has(call)) {
    return [{ node: calledName(call), type: calledValueType(context, call) }];
  }
  const receiver = context.callAt(call)?.receiver;
  return receiver === undefined ? [] : [{ node: receiver, type: context.typeOf(receiver) }];
}
