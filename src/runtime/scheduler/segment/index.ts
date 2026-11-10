/**
 * One segment: what an instance runs between two commits (spec §5).
 *
 * A segment takes the next ready execution as its driver and runs it until it awaits. That await
 * ends the segment, and the scheduler commits. A driver that returns instead hands the segment to
 * the next ready execution, so the segment ends at the next await of whichever driver reaches one,
 * or when nothing is ready. Every await by a driver therefore commits, and code between two
 * commits is one atomic segment. A live run (proposal 8) runs its segments the same way, but never
 * commits one, reads the clock for `now()`, and panics where a promise's JSON doesn't fit
 * (`startLiveSegment`, `runLiveSegment`).
 *
 * An async call starts its callee at once, inside the caller's segment: the callee's execution
 * runs on top of the caller's until it awaits or returns, and only then does the caller receive
 * its future and go on. The callee's first await doesn't commit. It gives control back, and the
 * callee's effects so far commit or roll back with the caller's segment. Executions on top of one
 * another form the run stack; it lives here, not on JavaScript's stack, so a deep chain of async
 * calls can't overflow it. When a segment ends, the run stack holds only its driver, and every
 * other execution stands at an `await`, as a snapshot requires. Every call is a `call`
 * instruction, so a program's calls never nest on JavaScript's stack.
 *
 * What a segment leaves is persisted when it commits, so it must nest no deeper than a snapshot
 * may (limits.ts).
 *
 * The root's last frame returns the instance's outcome: a plain root giving a future waits on it
 * there, and the instance's encoder, if it has one, encodes the outcome for the host before the
 * frame returns (root-outcome.ts).
 *
 * After every instruction that let go of something, the segment collects (collection.ts): what
 * lost its last holder is disposed right there (§7). A disposal that runs code runs on the run
 * stack as any call does (disposal-runs.ts). A drive ends only once collecting has. An
 * execution running on the run stack holds its own call future, so code that lets go of the last
 * holder of its own call runs on until it suspends, and is stopped there.
 */

import type { Argument } from '../../../definition/instructions/places.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import { depthOf, handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { runInstruction } from '../../interpreter/instructions.ts';
import {
  type Machine,
  newFrame,
  releaseFrame,
  resumeAfterCall,
} from '../../interpreter/machine.ts';
import { argumentContents, readRegister } from '../../interpreter/registers.ts';
import { waitedRegisters } from '../../interpreter/suspension.ts';
import type { Panic } from '../../natives.ts';
import type { HeapObject } from '../../snapshot/objects.ts';
import type { LiveExecution } from '../instance/heap.ts';
import { type Instance, topFrame } from '../instance/index.ts';
import { startAnswer } from '../testing/mocks.ts';
import type { MockCall } from '../testing/test-world.ts';
import { istaWaiting, type LiveResumes, resumedPanicOf, type Waiting } from '../waiting.ts';
import {
  type Caller,
  type CallTarget,
  handOver,
  returnedValue,
  runsAsExecution,
  startCall,
} from './calls.ts';
import { SegmentCollection } from './collection.ts';
import { panicOf, requireDepth } from './limits.ts';
import { NativeCalls } from './native-calls.ts';
import { type Outcome, RootOutcome } from './root-outcome.ts';
import { RunStack } from './run-stack.ts';

/** What a segment begins with: an execution about to run from its start, or answering a call. */
export type SegmentStart =
  | { readonly kind: 'driver'; readonly execution: LiveExecution }
  | { readonly kind: 'answer'; readonly call: MockCall };

export type SegmentEnd =
  /** A driver awaited: commit `objects`, then run the next segment. */
  | { readonly kind: 'awaited'; readonly objects: readonly HeapObject[] }
  /** Nothing is ready: commit `objects`, then wait. */
  | { readonly kind: 'idle'; readonly objects: readonly HeapObject[] }
  /** The root returned: commit its outcome, encoded too when the instance has an encoder. */
  | ({ readonly kind: 'finished' } & Outcome)
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };

/**
 * Runs one segment of `instance`, which started at `startedAt`. It begins with `first`: an
 * execution about to run from its start, or the answer to a call to one of the instance's mocks
 * (§10); without one, with the next ready execution.
 */
export function runSegment(
  instance: Instance,
  startedAt: bigint,
  first?: SegmentStart,
): SegmentEnd {
  return new SegmentRunner(instance, () => startedAt, istaWaiting).run(first);
}

/** How a live run's segment ended: a driver awaited, nothing is ready, it finished or panicked. */
export type LiveSegmentEnd =
  | { readonly kind: 'awaited' }
  | { readonly kind: 'idle' }
  | Extract<SegmentEnd, { kind: 'finished' | 'panicked' }>;

/**
 * Runs the first segment of `instance` as a live run, resumed through `resumes`, its code reading
 * `now` for `now()`: `root` from its start. It runs inside its host's start, so JSON that doesn't
 * fit refuses the start, as an instance's first segment does.
 */
export function startLiveSegment(
  instance: Instance,
  now: () => bigint,
  resumes: LiveResumes,
  root: LiveExecution | undefined,
): LiveSegmentEnd {
  return new SegmentRunner(instance, now, { kind: 'live', resumes }).runLive(root, panicOf);
}

/**
 * Runs the next segment of the live run `instance`, as `startLiveSegment` does its first. What it
 * runs on, a promise's JSON, came with no host call that JSON not fitting could refuse, so it
 * panics the run, as a host's unfit result does (§3.12).
 */
export function runLiveSegment(
  instance: Instance,
  now: () => bigint,
  resumes: LiveResumes,
): LiveSegmentEnd {
  return new SegmentRunner(instance, now, { kind: 'live', resumes }).runLive(
    undefined,
    resumedPanicOf,
  );
}

/**
 * Ends `instance` (§3.12): its root stops, so what it held is disposed (§7), a disposed call's
 * cleanup included, then any execution that only other executions hold stops too. A disposal that
 * panics counts as done, so the rest still run and tell their hosts.
 */
export function endInstance(instance: Instance, startedAt: bigint): void {
  new SegmentRunner(instance, () => startedAt, istaWaiting).end();
}

/** How driving one execution ended. */
type DriveEnd = 'awaited' | 'returned' | { readonly finished: Outcome };

/** How a segment ended before what it leaves is checked for persisting. */
type RunEnd =
  | { readonly kind: 'awaited' }
  | { readonly kind: 'idle' }
  | Extract<SegmentEnd, { kind: 'finished' }>;

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #caller: Caller;
  readonly #natives: NativeCalls;
  readonly #runStack = new RunStack();
  readonly #collection: SegmentCollection;
  readonly #outcome: RootOutcome;
  #end: DriveEnd | undefined;

  constructor(instance: Instance, now: () => bigint, waiting: Waiting) {
    this.#instance = instance;
    this.#natives = new NativeCalls(instance, now, waiting, {
      trace: () => this.#runStack.trace(this.definition),
      callerTrace: () => this.#runStack.callerTrace(this.definition),
    });
    this.#caller = { instance, natives: this.#natives, now, waiting };
    const running = { instance, caller: this.#caller, runStack: this.#runStack };
    this.#outcome = new RootOutcome(running);
    this.#collection = new SegmentCollection(running);
  }

  get definition() {
    return this.#instance.loaded.definition;
  }

  run(first: SegmentStart | undefined): SegmentEnd {
    return this.#panicking(() => {
      const driver =
        first?.kind === 'answer'
          ? startAnswer(this.#instance, this.#natives, first.call)
          : first?.execution;
      return this.#persistable(this.#runDrivers(driver));
    });
  }

  runLive(
    first: LiveExecution | undefined,
    panicking: (error: unknown) => Panic | undefined,
  ): LiveSegmentEnd {
    return this.#panicking(() => this.#runDrivers(first), panicking);
  }

  /** What `run` gives, or the panic it threw, as `panicking` reads it, where it threw it. */
  #panicking<End>(
    run: () => End,
    panicking: (error: unknown) => Panic | undefined = panicOf,
  ): End | Extract<SegmentEnd, { kind: 'panicked' }> {
    try {
      return run();
    } catch (error) {
      const panic = panicking(error);
      if (panic !== undefined) {
        return {
          kind: 'panicked',
          message: panic.message,
          trace: this.#runStack.trace(this.definition),
        };
      }
      throw error;
    }
  }

  end(): void {
    const root = this.#instance.root();
    const step = () => this.#step();
    if (root !== undefined) {
      this.#instance.stop(root);
      this.#collection.collectEnding(step);
    }
    for (const execution of this.#instance.heap.objectsOf('execution')) {
      this.#instance.stop(execution);
    }
    this.#collection.collectEnding(step);
  }

  /**
   * Calls `callee`, or the replacement of a mock replacing it (§10), never itself mocked, so it may
   * call what it replaces; a call another instance's mock answers resumes with the answer.
   */
  call(
    frame: ActiveFrame,
    callee: FunctionId,
    argumentList: readonly Argument[],
    captures: readonly Value[] = [],
  ): void {
    const contents = argumentList.map((argument) => argumentContents(frame, argument));
    this.#enter(frame, startCall(this.#caller, callee, contents, captures));
  }

  handOver(frame: ActiveFrame): void {
    this.#enter(frame, handOver(this.#caller, frame));
  }

  /** Runs `target`, what `frame` calls: answered, `frame` resumes at once; code, on top of it. */
  #enter(frame: ActiveFrame, target: CallTarget): void {
    if (target.kind === 'answered') {
      this.#resume(frame, target.value);
      return;
    }
    const { entry } = target;
    if (runsAsExecution(entry)) {
      const future = this.#instance.futures.create({ kind: 'call' });
      this.#runStack.push(
        this.#instance.startExecution(entry, target.contents, target.captures, future),
      );
      return;
    }
    this.#runStack.pushFrame(newFrame(entry, target.contents, frame.heap, target.captures));
  }

  /**
   * Gives `frame` `value`, what the call it made gave: as its `call`'s result, or, standing where
   * its body begins, having handed its own call over to a mock (calls.ts), as its own result.
   */
  #resume(frame: ActiveFrame, value: Value): void {
    if (frame.code.instructions[frame.pc]?.kind === 'body') {
      this.return(frame, value);
      return;
    }
    resumeAfterCall(frame, value);
  }

  return(frame: ActiveFrame, given: Value): void {
    const returning = this.#outcome.returning(frame, given);
    if (returning.kind === 'wait') {
      this.wait(frame);
      return;
    }
    if (returning.kind === 'encode') {
      return;
    }
    const { value } = returning;
    const execution = this.#runStack.popFrame(frame);
    releaseFrame(frame);
    if (this.#collection.disposals.returned(execution, frame)) {
      return;
    }
    const returned = returnedValue(this.#instance, frame, value);
    const rootReturn = this.#outcome.returned(frame, returned);
    if (rootReturn !== undefined) {
      this.return(rootReturn.root, rootReturn.outcome);
      return;
    }
    const caller = execution.frames.at(-1);
    if (caller !== undefined) {
      this.#resume(caller, returned);
      return;
    }
    if (this.#collection.disposals.suspended(execution)) {
      return;
    }
    const future = execution.resolves;
    if (future === undefined) {
      this.#end = { finished: this.#outcome.finished(returned) };
      return;
    }
    this.#instance.remove(execution);
    this.#instance.futures.resolve(future, returned);
    this.#leave(future, 'returned');
  }

  wait(frame: ActiveFrame): void {
    const execution = this.#runStack.current();
    if (this.#collection.disposals.suspended(execution)) {
      return;
    }
    const instruction = frame.code.instructions[frame.pc];
    const awaited = instruction === undefined ? [] : waitedRegisters(instruction);
    if (awaited.some((register) => this.settled(readRegister(frame, register)) !== undefined)) {
      this.#instance.markReady(execution);
    }
    if (this.#runStack.driverOnly) {
      this.#runStack.pop();
      this.#instance.heap.noteReleased(
        execution.resolves === undefined ? [] : [execution.resolves],
      );
      this.#end = 'awaited';
      return;
    }
    if (execution.resolves === undefined) {
      unreachable(`Execution ${execution.id} runs on top of another without a call future.`);
    }
    this.#leave(execution.resolves, 'awaited');
  }

  readonly settled = (handle: Value): { readonly value: Value } | undefined =>
    this.#instance.futures.settled(handle);

  currentCall(): Value {
    return this.#instance.weak.reference(handleTo(this.#runStack.current().id));
  }

  /** Runs drivers until one awaits, the root returns, or nothing is ready. */
  #runDrivers(first: LiveExecution | undefined): RunEnd {
    // Answers withdrawn from their callers let go of what they wait on before any execution runs.
    this.#collection.collectFully(() => this.#step());
    for (
      let driver = first ?? this.#instance.resumeNext();
      driver !== undefined;
      driver = this.#instance.resumeNext()
    ) {
      const end = this.#drive(driver);
      if (end === 'awaited') {
        return { kind: 'awaited' };
      }
      if (end !== 'returned') {
        return { kind: 'finished', ...end.finished };
      }
    }
    return { kind: 'idle' };
  }

  /**
   * `end` with what a commit persists, found in one walk; a panic when it holds a value too deep
   * to persist (§5).
   */
  #persistable(end: RunEnd): Exclude<SegmentEnd, { kind: 'panicked' }> {
    if (end.kind === 'finished') {
      requireDepth(depthOf(end.outcome));
      if (end.encoded !== undefined) {
        requireDepth(depthOf(end.encoded));
      }
      return end;
    }
    const { objects, depth } = this.#instance.persisted();
    requireDepth(depth);
    return { kind: end.kind, objects };
  }

  /** Runs `driver` until it awaits or returns, and collecting what that let go of is done. */
  #drive(driver: LiveExecution): DriveEnd {
    this.#runStack.drive(driver);
    this.#end = undefined;
    for (;;) {
      if (this.#collection.collected() && this.#end !== undefined) {
        return this.#end;
      }
      this.#step();
    }
  }

  /** Runs the instruction the top frame stands at. */
  #step(): void {
    const frame = topFrame(this.#runStack.current());
    const instruction = frame.code.instructions[frame.pc];
    if (instruction === undefined) {
      unreachable(`pc ${frame.pc} is past the end; loading checks termination.`);
    }
    runInstruction(this, frame, instruction);
  }

  /**
   * Takes the top execution, which just awaited or returned, off the run stack. The execution
   * under it receives the call's future; with none under it, the driver's run ends with `end`.
   */
  #leave(future: number, end: 'awaited' | 'returned'): void {
    const caller = this.#runStack.pop();
    if (caller === undefined) {
      this.#end = end;
      return;
    }
    this.#resume(topFrame(caller), handleTo(future));
  }
}
