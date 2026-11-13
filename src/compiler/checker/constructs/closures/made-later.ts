/**
 * The call the function a deferred call gives makes later (§3.14), once checked inside that
 * function (syntax/expressions/deferred-functions.ts): what it computed now is captured, and what
 * can't be is refused.
 *
 * - That function makes its deferred call's call (`madeLaterBy`), whose parts run where the
 *   outermost deferred call it is part of stands: `a b c(x)` computes `x` once, where it is written,
 *   so the outer function captures what the inner one does, after what its own call computes.
 * - What it computes now, in the order it runs: its callee's value (a function value, a field
 *   `x.f` read whole) or a method's receiver, then each argument written, a spread's as what it
 *   collects (`collectedBy`), not the iterable it runs over. Each is checked where the deferred call
 *   stands (`Functions.computedNow`) and captured as a copy (`Functions.captureNow`), by every
 *   function from there in.
 * - Nothing captured can be a reference, so a `&` argument, or a receiver its method takes by
 *   `&self`, is refused. A call in an optional chain may not happen at all, and a variant without
 *   fields is a value, so neither can be deferred. A refused call gives its function the error type,
 *   so it is reported once.
 * - A call that stops before it is made, its callee or receiver having no value, captures nothing,
 *   as an argument with no value gives none (§2).
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import { argumentValue } from '../../../syntax/expressions/arguments.ts';
import type { CallingNode, DeferredCall } from '../../../syntax/expressions/calls.ts';
import {
  deferredCallOf,
  deferredLambdaOf,
  makesItsCall,
} from '../../../syntax/expressions/deferred-functions.ts';
import type { Expression, Spread } from '../../../syntax/expressions/index.ts';
import {
  calledName,
  deferredOf,
  writtenArgumentsOf,
} from '../../../syntax/expressions/readings.ts';
import type { BodyContext, Functions, MadeLater } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { ComputedCapture, NestedFunction } from '../../surface/checked-body.ts';
import { calledVariant } from '../../surface/named-variants.ts';
import { isPack } from '../../types/type/function-types.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { arrayElement, arrayOf } from '../../types/type/well-known.ts';
import { calledValueType } from './value-calls.ts';

/**
 * What the call deferred call `node` makes later, of `type` as checked settled, gives the function
 * making it: `type`, what it computed now captured wherever the function makes its call
 * (`makesItsCall`), even past a mistake, so it runs where it is written; the error type after a
 * refusal.
 */
export function madeLater(context: BodyContext, node: DeferredCall, type: Type): Type {
  const call = deferredOf(node) ?? unreachable('A deferred call reads as a lambda only of a call.');
  if (!makesItsCall(node, (each) => isMade(context, each))) {
    return type.kind === 'error' ? type : unmade(context, call, type);
  }
  context.functions.captureNow(context, call, () => computedNow(context, call));
  return type.kind !== 'error' && refused(context, call) ? errorType : type;
}

/** Whether checking made `call`: resolved to a function, or a call of a function value. */
function isMade(context: BodyContext, call: CallingNode): boolean {
  return context.calls.of(call) !== undefined || context.valueCalls.has(call);
}

/**
 * What a call its deferred call's function doesn't make gives: `type`, after a stop (§2); a variant
 * without fields is a value, refused.
 */
function unmade(context: BodyContext, call: CallingNode, type: Type): Type {
  const variant = call.kind === 'Call' ? calledVariant(context, call)?.variant : undefined;
  if (variant === undefined || variant.fields.length > 0) {
    return type;
  }
  const callee = `'${variant.name.text}'`;
  const why = 'a variant without fields is a value, not a function';
  context.report(checkerDiagnostics.notDeferrable(calledName(call).span, callee, why));
  return errorType;
}

/**
 * Whether what `call` computes now can't be captured, reporting each: a reference, passed by `&` or
 * as a `&self` receiver, or a link of an optional chain.
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
  const resolved = context.calls.of(call);
  const receiver = resolved?.receiver;
  if (resolved === undefined || receiver === undefined) {
    return undefined;
  }
  return context.checker.parametersOf(resolved.function)[0]?.reference === true
    ? receiver
    : undefined;
}

/**
 * What `call` computed now, in the order it ran, each at the operand computing it, a spread at
 * itself; for a deferred call, then what the function it gives captured of its own call, which it
 * makes from these.
 */
function computedNow(context: BodyContext, call: CallingNode): readonly ComputedCapture[] {
  const written = writtenArgumentsOf(call).map((argument): ComputedCapture => {
    if (argument.kind === 'Spread') {
      return { kind: 'computed', site: argument, type: collectedBy(context, argument) };
    }
    const site = argumentValue(argument);
    return { kind: 'computed', site, type: context.typeOf(site) };
  });
  const own = [...calleeNow(context, call), ...written];
  const inner = call.kind === 'DeferredCall' ? deferredLambdaOf(call) : undefined;
  const given = inner === undefined ? [] : (context.functions.checkedOf(inner)?.captures ?? []);
  return [...own, ...given.filter((capture) => capture.kind === 'computed')];
}

/** The value `call` calls, computed now: a function value, or a method's receiver; else none. */
function calleeNow(context: BodyContext, call: CallingNode): readonly ComputedCapture[] {
  if (context.valueCalls.has(call)) {
    return [{ kind: 'computed', site: calledName(call), type: calledValueType(context, call) }];
  }
  const site = context.calls.of(call)?.receiver;
  return site === undefined ? [] : [{ kind: 'computed', site, type: context.typeOf(site) }];
}

/**
 * What a checked spread argument passes, as a call collects it where it is written (§3.3): a
 * pack's value whole (§3.5), else an array of its items, an array's elements copied or what its
 * cursor gave, as its iteration was recorded; its expression's own type where it has no items.
 */
function collectedBy(context: BodyContext, spread: Spread): Type {
  const type = context.typeOf(spread.expression);
  const form = isPack(type) ? undefined : context.iterations.formOf(spread);
  const item = form?.kind === 'cursor' ? form.item : form && arrayElement(context.checker, type);
  return item === undefined ? type : arrayOf(context.checker, item);
}

/**
 * What `node` makes later when it is the function a deferred call gives (`deferredCallOf`): the
 * call it defers, whose parts are computed where the outermost deferred call it is part of stands
 * (§3.14); undefined for any other function.
 */
export function madeLaterBy(functions: Functions, node: NestedFunction): MadeLater | undefined {
  const deferred = node.kind === 'Lambda' ? deferredCallOf(node) : undefined;
  if (deferred === undefined) {
    return undefined;
  }
  const call =
    deferredOf(deferred) ?? unreachable('A deferred call reads as a lambda only of a call.');
  const outer = functions.current.makesLater;
  return { call, now: outer?.call === deferred ? outer.now : functions.frames };
}
