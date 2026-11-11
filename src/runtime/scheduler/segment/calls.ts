/**
 * How a segment starts a call (§5, §10): every call path's one entry, a written call, a function
 * value's, a disposal's and a resolver's callback's (run-calls.ts) alike.
 *
 * - A mock replacing the target is asked first (mocks.ts): its replacement runs in the target's
 *   place, or another instance's mock answers at once. A replacement is never mocked itself, so it
 *   may call what it replaces.
 * - A mock replaces a function's body, not its defaults (§3.3): a call leaving parameters out to a
 *   mocked code entry runs the target's prologue first, as a plain frame on the caller's execution
 *   even for an async entry, since a prologue never waits. At its body's start the frame hands the
 *   call over (`handOver`) with every argument, as this call would have from the start: an answer
 *   is the frame's result, and a replacement takes the frame's place (index.ts), so no trace shows
 *   the target.
 * - A native runs at once and answers the call; code gives the entry to push.
 * - Code that waits runs only in a run of its own kind (proposal 8's call rule): live code in a
 *   live run, ista code in an instance. The checker keeps every call so (K1), so a call across
 *   kinds is a bug, and running it would commit live code or keep ista code waiting in memory.
 * - What a replacement gives back arrives as another instance's would (mocks.ts `arriving`): a
 *   native's answer at once, code's when its frame returns, which `arrives` marks.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame, FrameEntry } from '../../interpreter/frames.ts';
import { capturesOf, parameterContents } from '../../interpreter/machine.ts';
import { givesEvery, type Passed, passedValues } from '../../interpreter/registers.ts';
import type { Instance } from '../instance/index.ts';
import { arriving, mockedCall, type ReachedMock, reachedMock } from '../testing/mocks.ts';
import type { Waiting } from '../waiting.ts';
import type { NativeCalls } from './native-calls.ts';

/** Who makes calls: an instance, its segment's natives, what `now()` reads there, how it waits. */
export interface Caller {
  readonly instance: Instance;
  readonly natives: NativeCalls;
  readonly now: () => bigint;
  readonly waiting: Waiting;
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
      readonly contents: readonly Passed[];
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
  contents: readonly Passed[],
  captures: readonly Value[],
): CallTarget {
  const run = { function: target, captures };
  const reached = reachedMock(caller.instance, target);
  if (reached === undefined) {
    return runCall(caller, run, contents);
  }
  const callable = caller.instance.loaded.functions.callee(target);
  if (callable.kind === 'code' && !givesAll(callable.code.parameters.length, contents)) {
    return { kind: 'code', entry: { ...callable, handsOver: true }, contents, captures };
  }
  return replacedCall(caller, target, reached, contents);
}

/**
 * The call `frame`, its prologue run, hands over where its body begins: to the mock replacing its
 * function, with every argument; or, should none replace it any more, to the function itself.
 */
export function handOver(caller: Caller, frame: ActiveFrame): CallTarget {
  const contents = parameterContents(frame);
  const reached = reachedMock(caller.instance, frame.function);
  return reached === undefined
    ? runCall(caller, { function: frame.function, captures: capturesOf(frame) }, contents)
    : replacedCall(caller, frame.function, reached, contents);
}

/** Whether `entry` runs as an execution of its own: code that may wait, unless it hands over. */
export function runsAsExecution(entry: FrameEntry): boolean {
  return entry.code.mode !== 'simple' && entry.handsOver !== true;
}

/** What `frame` returning `value` in `instance` hands back: arrived when it ran a mock. */
export function returnedValue(instance: Instance, frame: ActiveFrame, value: Value): Value {
  return frame.arrives ? arriving(instance, value) : value;
}

/** The call to `target` with `contents`, made to `reached`, the mock replacing it. */
function replacedCall(
  caller: Caller,
  target: FunctionId,
  reached: ReachedMock,
  contents: readonly Passed[],
): CallTarget {
  const { instance } = caller;
  const values = () => passedValues(instance.frameHeap, givenContents(contents));
  const mocked = mockedCall({ instance, startedAt: caller.now(), target, values }, reached);
  if (mocked.kind === 'answered') {
    return mocked;
  }
  return arrivingFrom(instance, runCall(caller, mocked.replacement, mocked.values));
}

/** Runs `run` with `passed`: a native at once, code as the entry to push. */
function runCall(caller: Caller, run: Run, passed: readonly Passed[]): CallTarget {
  const callable = caller.instance.loaded.functions.callee(run.function);
  if (callable.kind === 'native') {
    const { natives } = caller;
    return {
      kind: 'answered',
      value: natives.call(run.function, callable.native, givenContents(passed)),
    };
  }
  const { mode } = callable.code;
  if (mode !== 'simple' && mode !== caller.waiting.kind) {
    unreachable(`A ${caller.waiting.kind} run calls ${mode} code, which the call rule refuses.`);
  }
  return { kind: 'code', entry: callable, contents: passed, captures: run.captures };
}

/** Whether `passed` gives every one of `parameters` parameters, none left out. */
function givesAll(parameters: number, passed: readonly Passed[]): boolean {
  return passed.length >= parameters && givesEvery(passed);
}

/**
 * `passed`, every parameter given: what a native or a mock takes, a call leaving out only what
 * code computes (loading refuses an extern's left out, and a mock takes over past the prologue).
 */
function givenContents(passed: readonly Passed[]) {
  if (!givesEvery(passed)) {
    unreachable('A native or a mock is passed a parameter left out.');
  }
  return passed;
}

/** `target` of a mock's replacement, whose answer arrives in `instance` as another's would. */
function arrivingFrom(instance: Instance, target: CallTarget): CallTarget {
  return target.kind === 'answered'
    ? { kind: 'answered', value: arriving(instance, target.value) }
    : { ...target, entry: { ...target.entry, arrives: true } };
}
