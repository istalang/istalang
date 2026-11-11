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
 * An async call starts its callee at once, inside the caller's segment, on top of the caller on
 * the run stack (run-stack.ts) until it awaits or returns, and only then does the caller receive
 * its future and go on (returns.ts). The callee's first await doesn't commit: its effects so far
 * commit or roll back with the caller's segment. When a segment ends, the run stack holds only its
 * driver, and every other execution stands at an `await`, as a snapshot requires.
 *
 * What a segment leaves is persisted when it commits, so it must nest no deeper than a snapshot
 * may (limits.ts).
 *
 * The root's answer is the instance's outcome, awaited when it is a future, and encoded for the
 * host by the instance's encoder (root-outcome.ts).
 *
 * After every instruction that let go of something, the segment collects (collection.ts): what
 * lost its last holder is disposed right there (§7). A disposal that runs code runs on the run
 * stack as any call does (disposal-runs.ts). A drive ends only once collecting has. An
 * execution running on the run stack holds its own call future, so code that lets go of the last
 * holder of its own call runs on until it suspends, and is stopped there.
 */

import type { Argument } from '../../../definition/instructions/places.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import { handleTo, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { runInstruction } from '../../interpreter/instructions.ts';
import {
  type Machine,
  newFrame,
  releaseFrame,
  resumeAfterCall,
} from '../../interpreter/machine.ts';
import { argumentContents } from '../../interpreter/registers.ts';
import type { Decision } from '../../interpreter/suspension.ts';
import type { InstanceCall, Invocation } from '../../snapshot/snapshot.ts';
import type { LiveExecution, LiveObjectOf } from '../instance/heap.ts';
import { type Instance, topFrame } from '../instance/index.ts';
import type { ReadyToRun } from '../instance/ready.ts';
import { startAnswer } from '../testing/mocks.ts';
import type { MockCall } from '../testing/test-world.ts';
import { istaWaiting, type LiveWaiting, type Waiting } from '../waiting.ts';
import { startInvocation } from './answering.ts';
import { type Caller, type CallTarget, handOver, runsAsExecution, startCall } from './calls.ts';
import { SegmentCollection } from './collection.ts';
import { NativeCalls } from './native-calls.ts';
import { type DriveEnd, landReturn, leave, type ReturnSeams } from './returns.ts';
import { type Arrival, type Outcome, RootOutcome } from './root-outcome.ts';
import { RunCalls } from './run-calls.ts';
import { RunStack } from './run-stack.ts';
import {
  endOrPanic,
  type LiveSegmentEnd,
  persistable,
  type RunEnd,
  type SegmentEnd,
} from './segment-ends.ts';

/**
 * What a segment begins with: an execution about to run from its start, answering a call from
 * outside (answering.ts), or the call of an extern a new instance starts with (root-outcome.ts).
 */
export type SegmentStart =
  | { readonly kind: 'driver'; readonly execution: LiveExecution }
  | { readonly kind: 'answer'; readonly call: MockCall }
  | { readonly kind: 'invocation'; readonly invocation: Invocation }
  | { readonly kind: 'call'; readonly call: InstanceCall };

/**
 * Runs one segment of `instance`, which started at `startedAt`, beginning with `first`, or else
 * with the next ready execution.
 */
export function runSegment(
  instance: Instance,
  startedAt: bigint,
  first?: SegmentStart,
): SegmentEnd {
  return new SegmentRunner(instance, () => startedAt, istaWaiting).run(first);
}

/**
 * Runs the first segment of `instance` as a live run waiting as `waiting` says, its code reading
 * `now` for `now()`: `root` from its start. It runs inside its host's start, so JSON that doesn't
 * fit refuses the start, as an instance's first segment does.
 */
export function startLiveSegment(
  instance: Instance,
  now: () => bigint,
  waiting: LiveWaiting,
  root: LiveExecution | undefined,
): LiveSegmentEnd {
  return new SegmentRunner(instance, now, waiting).runLive(root);
}

/** Runs the next segment of the live run `instance`, as `startLiveSegment` does its first. */
export function runLiveSegment(
  instance: Instance,
  now: () => bigint,
  waiting: LiveWaiting,
): LiveSegmentEnd {
  return new SegmentRunner(instance, now, waiting).runLive(undefined);
}

/**
 * Ends `instance` (§3.12): its root and the answers it owes are let go of, its execution stopped or
 * the outcome it awaits dropped, so what they held is disposed (§7), a disposed call's cleanup
 * included, then any execution only others hold stops too. A disposal that panics counts as done.
 */
export function endInstance(instance: Instance, startedAt: bigint): void {
  new SegmentRunner(instance, () => startedAt, istaWaiting).end();
}

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #caller: Caller;
  readonly #natives: NativeCalls;
  readonly #runStack = new RunStack();
  readonly #collection: SegmentCollection;
  readonly #outcome: RootOutcome;
  readonly #runCalls = new RunCalls(this.#runStack);
  readonly #returns: ReturnSeams;
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
    this.#returns = {
      instance,
      runStack: this.#runStack,
      outcome: this.#outcome,
      collection: this.#collection,
      runCalls: this.#runCalls,
    };
  }

  get definition() {
    return this.#instance.loaded.definition;
  }

  run(first: SegmentStart | undefined): SegmentEnd {
    return this.#panicking(() =>
      persistable(this.#instance, this.#runDrivers(this.#started(first))),
    );
  }

  /** The execution `first` begins the segment with: none once an extern's root call is made. */
  #started(first: SegmentStart | undefined): LiveExecution | undefined {
    if (first?.kind === 'call') {
      this.#outcome.callExtern(first.call);
      return undefined;
    }
    if (first?.kind === 'answer') {
      return startAnswer(this.#instance, this.#natives, first.call);
    }
    return first?.kind === 'invocation'
      ? startInvocation(this.#instance, this.#natives, first.invocation)
      : first?.execution;
  }

  runLive(first: LiveExecution | undefined): LiveSegmentEnd {
    return this.#panicking(() => this.#runDrivers(first));
  }

  /** What `run` gives, or the panic it threw, where it threw it. */
  #panicking<End>(run: () => End) {
    return endOrPanic(run, () => this.#runStack.trace(this.definition));
  }

  end(): void {
    const step = () => this.#step();
    this.#instance.releaseRoot();
    this.#instance.releaseAnswers();
    this.#collection.collectEnding(step);
    for (const execution of this.#instance.heap.objectsOf('execution')) {
      this.#instance.stop(execution);
    }
    this.#collection.collectEnding(step);
    this.#instance.releaseConstants(() => this.#collection.collectEnding(step));
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

  /**
   * Hands the call `frame` ran its prologue for over to the mock replacing its function (calls.ts):
   * an answer is the frame's result; a replacement takes the frame's place as the call's frame,
   * what disposal runs and the encoder track the frame by going over to it, while an async one
   * starts as an execution of its own, as the call would have from the start.
   */
  handOver(frame: ActiveFrame): void {
    const target = handOver(this.#caller, frame);
    if (target.kind === 'answered') {
      this.return(frame, target.value);
      return;
    }
    const execution = this.#runStack.popFrame(frame);
    releaseFrame(frame);
    if (runsAsExecution(target.entry)) {
      this.#enter(topFrame(execution), target);
      return;
    }
    const replacement = newFrame(target.entry, target.contents, frame.heap, target.captures);
    this.#collection.disposals.replaceFrame(frame, replacement);
    this.#outcome.replaceFrame(frame, replacement);
    this.#runStack.pushFrame(replacement);
  }

  /** Runs `target`, what `frame` calls: answered, `frame` resumes at once; code, on top of it. */
  #enter(frame: ActiveFrame, target: CallTarget): void {
    if (target.kind === 'answered') {
      resumeAfterCall(frame, target.value);
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

  return(frame: ActiveFrame, given: Value): void {
    this.#endWith(landReturn(this.#returns, frame, given));
  }

  wait(): void {
    const execution = this.#runStack.current();
    if (this.#collection.disposals.suspended(execution)) {
      return;
    }
    this.#instance.waits.stopped(execution);
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
    this.#endWith(leave(this.#runStack, execution.resolves, 'awaited'));
  }

  /** Ends the drive with `end`, if the step that gave it ended it. */
  #endWith(end: DriveEnd | undefined): void {
    if (end !== undefined) {
      this.#end = end;
    }
  }

  openWait(): Value {
    return this.#instance.waits.open(this.#runStack.current());
  }

  resolver(wait: Value, position: number): Value {
    return this.#instance.waits.resolver(wait, position);
  }

  endWait(): Decision | undefined {
    return this.#instance.waits.endNonBlocking(this.#runStack.current());
  }

  currentCall(): Value {
    return this.#instance.weak.reference(handleTo(this.#runStack.current().id));
  }

  /**
   * The instance finished with `outcome`, everything else it held disposed: it lets go of its
   * context constants last (§3.4).
   */
  #finished(outcome: Outcome): RunEnd {
    this.#instance.releaseConstants(() => this.#collection.collectFully(() => this.#step()));
    return { kind: 'finished', ...outcome };
  }

  /** Runs drivers until one awaits, the instance finishes, or nothing is ready. */
  #runDrivers(first: LiveExecution | undefined): RunEnd {
    // Answers withdrawn from their callers let go of what they wait on before any execution runs.
    this.#collection.collectFully(() => this.#step());
    for (let next = first ?? this.#next(); next !== undefined; next = this.#next()) {
      if (next.kind === 'finished') {
        // Letting go of the outcome awaited let go of what it held, as a root's last return does.
        this.#collection.collectFully(() => this.#step());
        return this.#finished(next.outcome);
      }
      const end = next.kind === 'run' ? this.#run(next) : this.#drive(next);
      if (end === 'awaited') {
        return { kind: 'awaited' };
      }
      if (end !== 'returned') {
        return this.#finished(end.finished);
      }
    }
    // A run answered at once let go of its arguments outside any drive, which collects first.
    this.#collection.collectFully(() => this.#step());
    return { kind: 'idle' };
  }

  /** Makes the call `run` readied and drives it as any driver: at once returned when answered. */
  #run(run: LiveObjectOf<'run'>): DriveEnd {
    const driver = this.#runCalls.start(this.#caller, run);
    return driver === undefined ? 'returned' : this.#drive(driver);
  }

  /** What runs next: an arrived outcome's encoder or itself (root-outcome.ts), else what is ready. */
  #next(): ReadyToRun | Extract<Arrival, { kind: 'finished' }> | undefined {
    const arrival = this.#outcome.arrival();
    if (arrival === undefined) {
      return this.#instance.resumeNext();
    }
    return arrival.kind === 'encode' ? arrival.root : arrival;
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
}
