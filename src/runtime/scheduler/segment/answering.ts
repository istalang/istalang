/**
 * Answering a call made into an instance from outside (§9, §10): another instance's call to one of
 * its mocks (../testing/mocks.ts), or a host's call into it as a context, an invocation.
 *
 * - The call runs as it would where it was made: a native at once, a function with a body in an
 *   execution of its own, which the segment drives first. Its answer waits on the call's future and
 *   is given once that resolves (../instance/futures.ts), an effect of the commit that has it.
 * - Simple code giving a future still pending, as a deferred call's closure gives its callee's,
 *   waits on it as an async driver awaits (index.ts): the segment ends there, so the callee's first
 *   await commits, as it does under an instance's root.
 * - An invocation's captures and arguments arrive as any value crossing in
 *   (../instance/crossing.ts): a live run's call is a closure taking nothing, a deferred call that
 *   computed its arguments where it was made.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import type { Invocation } from '../../snapshot/snapshot.ts';
import { arriving } from '../instance/crossing.ts';
import type { Caller } from '../instance/futures.ts';
import type { LiveExecution } from '../instance/heap.ts';
import type { Instance } from '../instance/index.ts';
import type { NativeCalls } from './native-calls.ts';

/** A call to answer: what it calls, with which captures and arguments, and who it answers. */
interface AnsweredCall {
  readonly function: FunctionId;
  readonly captures: readonly Value[];
  readonly arguments: readonly Value[];
  readonly caller: Caller;
}

/**
 * Starts answering `call` in `instance`, calling natives through `natives`: the execution to drive
 * first, or none for a native, whose answer is given at once.
 */
export function startAnswering(
  instance: Instance,
  natives: NativeCalls,
  call: AnsweredCall,
): LiveExecution | undefined {
  const future = instance.futures.create({ kind: 'call' });
  instance.futures.answer(future, call.caller);
  const callable = instance.loaded.functions.callee(call.function);
  if (callable.kind === 'code') {
    return instance.startExecution(callable, call.arguments, call.captures, future);
  }
  instance.futures.resolve(future, natives.call(call.function, callable.native, call.arguments));
  return undefined;
}

/** Starts the host's call `invocation` into `instance`, a context, as `startAnswering` does. */
export function startInvocation(
  instance: Instance,
  natives: NativeCalls,
  { call, token }: Invocation,
): LiveExecution | undefined {
  const arrived = (values: readonly Value[]) => values.map((each) => arriving(instance, each));
  return startAnswering(instance, natives, {
    function: call.function,
    captures: arrived(call.captures),
    arguments: arrived(call.arguments),
    caller: { token },
  });
}
