/**
 * How a segment starts a call (§5, §10): every call path's one entry, a written call, a function
 * value's and a disposal's alike.
 *
 * - A mock replacing the target is asked first (mocks.ts): its replacement runs in the target's
 *   place, or another instance's mock answers at once. A replacement is never mocked itself, so it
 *   may call what it replaces.
 * - A native runs at once and answers the call; code gives the entry to push.
 * - What a replacement gives back arrives as another instance's would (mocks.ts `arriving`): a
 *   native's answer at once, code's when its frame returns, which `arrives` marks.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import type { ActiveFrame, FrameEntry } from '../../interpreter/frames.ts';
import { passedValues } from '../../interpreter/registers.ts';
import type { RegisterContents } from '../../snapshot/objects.ts';
import type { Instance } from '../instance/index.ts';
import type { NativeCalls } from '../native-calls.ts';
import { arriving, mockedCall } from '../testing/mocks.ts';

/** Who makes calls: an instance, its segment's natives, and when the segment started. */
export interface Caller {
  readonly instance: Instance;
  readonly natives: NativeCalls;
  readonly startedAt: bigint;
}

/**
 * What a call does: resumes at once with `value` when a native or another instance's mock answered
 * it, or runs `entry` with `contents` and `captures`.
 */
export type CallTarget =
  | { readonly kind: 'answered'; readonly value: Value }
  | {
      readonly kind: 'code';
      readonly entry: FrameEntry;
      readonly contents: readonly RegisterContents[];
      readonly captures: readonly Value[];
    };

/** A function to run with its captures: a call's target, or a mock's replacement of it. */
interface Run {
  readonly function: FunctionId;
  readonly captures: readonly Value[];
}

/** Starts a call from `caller` to `target` with `contents` and `captures`. */
export function startCall(
  caller: Caller,
  target: FunctionId,
  contents: readonly RegisterContents[],
  captures: readonly Value[],
): CallTarget {
  const { instance, startedAt } = caller;
  const values = () => passedValues(instance.frameHeap, contents);
  const mocked = mockedCall({ instance, startedAt, target, values });
  if (mocked === undefined) {
    return runCall(caller, { function: target, captures }, contents);
  }
  if (mocked.kind === 'answered') {
    return mocked;
  }
  return arrivingFrom(instance, runCall(caller, mocked.replacement, mocked.values));
}

/** What `frame` returning `value` in `instance` hands back: arrived when it ran a mock. */
export function returnedValue(instance: Instance, frame: ActiveFrame, value: Value): Value {
  return frame.arrives ? arriving(instance, value) : value;
}

/** Runs `run` with `passed`: a native at once, code as the entry to push. */
function runCall(caller: Caller, run: Run, passed: readonly RegisterContents[]): CallTarget {
  const callable = caller.instance.loaded.functions.callee(run.function);
  if (callable.kind === 'native') {
    return { kind: 'answered', value: caller.natives.call(run.function, callable.native, passed) };
  }
  return { kind: 'code', entry: callable, contents: passed, captures: run.captures };
}

/** `target` of a mock's replacement, whose answer arrives in `instance` as another's would. */
function arrivingFrom(instance: Instance, target: CallTarget): CallTarget {
  return target.kind === 'answered'
    ? { kind: 'answered', value: arriving(instance, target.value) }
    : { ...target, entry: { ...target.entry, arrives: true } };
}
