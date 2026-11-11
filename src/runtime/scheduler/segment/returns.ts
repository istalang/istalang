/**
 * Where a frame's `return` lands (§5, §9): in the frame that called it, on the same execution; in
 * the call future an execution's last frame resolves, the caller under it on the run stack
 * receiving that future; or at the end of the driver's run, as an awaiting or returning one, or as
 * the instance's outcome when it is the root's (root-outcome.ts).
 *
 * - The root's outcome is encoded before its last frame returns it, so a return may first start
 *   the encoder, landing later (`returning`).
 * - A disposal's call or a run's callback ends where it was started (disposal-runs.ts,
 *   run-calls.ts), never as a call future.
 * - A simple driver giving a future still pending waits on it as an async driver awaits: the
 *   segment ends, stopped where the call resolving it waits.
 */

import { handleTo, type Value } from '../../../definition/values/values.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { releaseFrame, resumeAfterCall } from '../../interpreter/machine.ts';
import { type Instance, topFrame } from '../instance/index.ts';
import { returnedValue } from './calls.ts';
import type { SegmentCollection } from './collection.ts';
import type { Outcome, RootOutcome } from './root-outcome.ts';
import type { RunCalls } from './run-calls.ts';
import type { RunStack } from './run-stack.ts';

/** How driving one execution ended. */
export type DriveEnd = 'awaited' | 'returned' | { readonly finished: Outcome };

/** What a return reaches of the segment it lands in. */
export interface ReturnSeams {
  readonly instance: Instance;
  readonly runStack: RunStack;
  readonly outcome: RootOutcome;
  readonly collection: SegmentCollection;
  readonly runCalls: RunCalls;
}

/** Lands `frame`'s return of `given`; how the drive ends there, if it does. */
export function landReturn(
  seams: ReturnSeams,
  frame: ActiveFrame,
  given: Value,
): DriveEnd | undefined {
  const { instance, runStack, outcome, collection, runCalls } = seams;
  const returning = outcome.returning(frame, given);
  if (returning.kind === 'encode') {
    return undefined;
  }
  const value = returning.kind === 'return' ? returning.value : given;
  const execution = runStack.popFrame(frame);
  releaseFrame(frame);
  if (collection.disposals.returned(execution, frame)) {
    return undefined;
  }
  const returned = returnedValue(instance, frame, value);
  const rootReturn = outcome.returned(frame, returned);
  if (rootReturn?.root !== undefined) {
    return landReturn(seams, rootReturn.root, rootReturn.outcome);
  }
  if (rootReturn !== undefined) {
    return { finished: outcome.finished(rootReturn.outcome) };
  }
  const caller = execution.frames.at(-1);
  if (caller !== undefined) {
    resumeAfterCall(caller, returned);
    return undefined;
  }
  if (collection.disposals.suspended(execution)) {
    return undefined;
  }
  if (runCalls.returned(execution)) {
    return 'returned';
  }
  const future = execution.resolves;
  if (future === undefined && returning.kind === 'await') {
    instance.remove(execution);
    runStack.pop();
    waitsOn(seams, returned);
    return 'awaited';
  }
  if (future === undefined) {
    return { finished: outcome.finished(returned) };
  }
  instance.remove(execution);
  instance.futures.resolve(future, returned);
  const waits = frame.code.mode === 'simple' && waitsOn(seams, returned);
  return leave(runStack, future, waits ? 'awaited' : 'returned');
}

/**
 * Takes the top execution, which just awaited or returned, off the run stack. The execution under
 * it receives the call's future; with none under it, the driver's run ends with `end`.
 */
export function leave(
  runStack: RunStack,
  future: number,
  end: 'awaited' | 'returned',
): DriveEnd | undefined {
  const caller = runStack.pop();
  if (caller === undefined) {
    return end;
  }
  resumeAfterCall(topFrame(caller), handleTo(future));
  return undefined;
}

/**
 * Whether `returned`, what a simple driver gives, is a future still pending, which it then waits
 * on as an async driver awaits: the segment ends, stopped where the call resolving it waits.
 */
function waitsOn({ instance, runStack }: ReturnSeams, returned: Value): boolean {
  const awaited = instance.futures.pendingIn(returned);
  if (awaited === undefined) {
    return false;
  }
  runStack.stoppedIn(instance.heap.find('executions', awaited)[0]);
  return true;
}
