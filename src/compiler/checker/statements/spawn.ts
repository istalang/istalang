/**
 * `spawn f(args)` (§9): starts a call as a new, independent instance and goes on at once, so it
 * is a statement of type `unit`, in any function.
 *
 * - The call is checked as any call is, which resolves what it runs. A function with code may be
 *   spawned, a method or a generic instance included, and so may a value of a sendable function
 *   type, whose captures go along (§3.14). An extern has no code to start, a reference parameter
 *   has no place in another instance, a function a constraint requires is known only per
 *   instantiation, and a call through `?.` may not happen at all, so none of them can be.
 * - Every argument, a method's receiver included, is copied into the new instance, so it must be
 *   sendable (§3.1).
 */

import { type Call, type Expression, unparenthesized } from '../../syntax/expressions.ts';
import type { Spawn } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isSendable } from '../traits/sendable.ts';
import { type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkSpawn(context: BodyContext, node: Spawn): Type {
  const call = unparenthesized(node.call);
  if (call.kind !== 'Call') {
    context.expression(node.call);
    context.report(checkerDiagnostics.spawnNeedsCall(node.call.span));
    return unitType;
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
  return unitType;
}

/** Why the function `call` runs can't start an instance, naming it; undefined when it can. */
function refusalOf(
  context: BodyContext,
  call: Call,
): { readonly callee: string; readonly why: string } | undefined {
  if (context.chains.chainOf(call) !== undefined) {
    return { callee: 'A call through ?.', why: 'whether it happens is known only when it runs' };
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
  const written = call.arguments.map((argument) =>
    argument.kind === 'Spread' ? argument.expression : argument,
  );
  return receiver === undefined ? written : [receiver, ...written];
}
