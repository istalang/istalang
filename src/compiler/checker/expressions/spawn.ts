/**
 * `spawn f(args)` (§9): starts a call as a new, independent instance and goes on at once, in any
 * function. Its value is the new instance's `Instance<T>`, `T` being what the function returns, or
 * what an async one's future gives, since that is the instance's outcome.
 *
 * - The call is checked as any call is, which resolves what it runs. A function with code may be
 *   spawned, a method or a generic instance included, and so may a value of a sendable function
 *   type, whose captures go along (§3.14). An extern has no code to start, a reference parameter
 *   has no place in another instance, a function a constraint requires is known only per
 *   instantiation, and a call through `?.` may not happen at all, so none of them can be.
 * - Every argument, a method's receiver included, is copied into the new instance, so it must be
 *   sendable (§3.1).
 * - When a codec writes the new instance's outcome, the spawn records it as an implicit call, so the
 *   host can read that outcome as JSON (§9). A generic body records it as it checks everything,
 *   once, against its type parameters' constraints (§3.5), and its calls count in its expansion.
 */

import { wellKnown } from '../../../language/well-known.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import type { Call, Expression, Spawn } from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isSendable } from '../traits/sendable.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureArgument, wellKnownOf } from '../types/well-known.ts';

export function checkSpawn(context: BodyContext, node: Spawn): Type {
  const call = unparenthesized(node.call);
  if (call.kind !== 'Call') {
    context.expression(node.call);
    context.report(checkerDiagnostics.spawnNeedsCall(node.call.span));
    return errorType;
  }
  context.expression(call);
  const refusal = refusalOf(context, call);
  if (refusal !== undefined) {
    context.report(checkerDiagnostics.notSpawnable(call.callee.span, refusal.callee, refusal.why));
  }
  for (const argument of copiedArguments(context, call)) {
    const type = context.typeOf(argument);
    if (type.kind !== 'error' && !isSendable(context.checker, type)) {
      context.report(checkerDiagnostics.unsendableArgument(argument.span, typeText(type)));
    }
  }
  const outcome = outcomeOf(context, call);
  const encoder = context.checker.json.codecOf(outcome, 'write');
  if (encoder !== undefined) {
    context.implicit.record(node, 'encodeOutcome', encoder);
  }
  return wellKnownOf(context.checker, wellKnown.instance, [outcome]);
}

/** What the instance `call` starts ends with: what its function returns, an async one's awaited. */
function outcomeOf(context: BodyContext, call: Call): Type {
  const returned = context.typeOf(call);
  const resolved = context.callAt(call);
  const callee = context.typeOf(call.callee);
  const isAsync =
    resolved === undefined
      ? callee.kind === 'function' && callee.isAsync
      : resolved.function.isAsync;
  return isAsync ? (futureArgument(context.checker, returned) ?? returned) : returned;
}

/** Why the function `call` runs can't start an instance, naming it; undefined when it can. */
function refusalOf(
  context: BodyContext,
  call: Call,
): { readonly callee: string; readonly why: string } | undefined {
  if (context.chains.chainOf(call) !== undefined) {
    return {
      callee: 'A call in an optional chain',
      why: 'whether it happens is known only when it runs',
    };
  }
  const resolved = context.callAt(call);
  if (resolved === undefined) {
    const type = context.typeOf(call.callee);
    return type.kind !== 'function' || type.isSendable
      ? undefined
      : {
          callee: typeText(type),
          why: 'a value of a plain function type may capture what only its instance has',
        };
  }
  const callee = `'${resolved.function.name.text}'`;
  if (resolved.kind === 'requirement') {
    return { callee, why: 'a constraint requires it, so which function it is depends on the type' };
  }
  if (resolved.function.isExtern) {
    return { callee, why: 'it is an extern, which has no code to start' };
  }
  if (context.checker.parametersOf(resolved.function).some((parameter) => parameter.reference)) {
    return { callee, why: 'it takes a reference, which has no place in another instance' };
  }
  return undefined;
}

/** What `call` copies into the new instance: a method's receiver, then each argument written. */
function copiedArguments(context: BodyContext, call: Call): readonly Expression[] {
  const receiver = context.callAt(call)?.receiver;
  const written = call.arguments.map(argumentValue);
  return receiver === undefined ? written : [receiver, ...written];
}
