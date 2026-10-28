/**
 * One segment: what an instance runs between two commits (spec §5).
 *
 * A segment takes the next ready execution as its driver and runs it until it awaits. That await
 * ends the segment, and the scheduler commits. A driver that returns instead hands the segment to
 * the next ready execution, so the segment ends at the next await of whichever driver reaches one,
 * or when nothing is ready. Every await by a driver therefore commits, and code between two
 * commits is one atomic segment.
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
 * After every instruction that let go of something, the segment collects (runtime/lifetimes/):
 * what lost its last holder is disposed right there (§7). A disposal that runs code runs on the
 * run stack as any call does (disposal-runs.ts). A drive ends only once collecting has. An
 * execution running on the run stack holds its own call future, so code that lets go of the last
 * holder of its own call runs on until it suspends, and is stopped there.
 */

import { awaitedRegisters } from '../../../definition/instructions/flow.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import { depthOf, handleTo, type Value } from '../../../definition/values.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { runInstruction } from '../../interpreter/instructions.ts';
import {
  type ActiveFrame,
  argumentContents,
  type Machine,
  newFrame,
  readRegister,
  releaseFrame,
  resumeAfterCall,
} from '../../interpreter/machine.ts';
import { Collector } from '../../lifetimes/collector.ts';
import type { Roots } from '../../lifetimes/holders.ts';
import type { HeapObject } from '../../snapshot/objects.ts';
import type { InstanceCall } from '../../snapshot/snapshot.ts';
import type { LiveExecution } from '../heap.ts';
import { type Instance, topFrame } from '../instance/index.ts';
import { startAnswer } from '../mocks.ts';
import { NativeCalls } from '../native-calls.ts';
import type { MockCall } from '../test-world.ts';
import { type Caller, returnedValue, startCall } from './calls.ts';
import { DisposalRuns } from './disposal-runs.ts';
import { panicOf, requireDepth } from './limits.ts';
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
  | { readonly kind: 'finished'; readonly outcome: Value }
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
  return new SegmentRunner(instance, startedAt).run(first);
}

/**
 * Ends `instance` (§3.12): its root stops, so what it held is disposed (§7), a disposed call's
 * cleanup included, then any execution that only other executions hold stops too. A disposal that
 * panics counts as done, so the rest still run and tell their hosts.
 */
export function endInstance(instance: Instance, startedAt: bigint): void {
  new SegmentRunner(instance, startedAt).end();
}

/** How driving one execution ended. */
type DriveEnd = 'awaited' | 'returned' | { readonly finished: Value };

/** How a segment ended before what it leaves is checked for persisting. */
type RunEnd = { readonly kind: 'awaited' | 'idle' } | Extract<SegmentEnd, { kind: 'finished' }>;

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #caller: Caller;
  readonly #natives: NativeCalls;
  readonly #runStack = new RunStack();
  readonly #collector: Collector;
  readonly #disposals: DisposalRuns;
  #end: DriveEnd | undefined;

  constructor(instance: Instance, startedAt: bigint) {
    this.#instance = instance;
    this.#natives = new NativeCalls(instance, startedAt, (leftOut) =>
      this.#runStack.trace(this.definition, leftOut),
    );
    this.#caller = { instance, natives: this.#natives, startedAt };
    this.#disposals = new DisposalRuns({
      instance,
      caller: this.#caller,
      runStack: this.#runStack,
      returned: () => {
        this.#collector.returned();
      },
    });
    this.#collector = new Collector({
      heap: instance.heap,
      types: instance.loaded.definition.types,
      roots: () => this.#roots(),
      stop: (execution) => {
        instance.stop(execution);
      },
      weak: instance.weak,
      run: (run) => this.#disposals.start(run),
    });
  }

  get definition() {
    return this.#instance.loaded.definition;
  }

  run(first: SegmentStart | undefined): SegmentEnd {
    try {
      const driver =
        first?.kind === 'answer'
          ? startAnswer(this.#instance, this.#natives, first.call)
          : first?.execution;
      return this.#persistable(this.#runDrivers(driver));
    } catch (error) {
      const panic = panicOf(error);
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
    if (root !== undefined) {
      this.#instance.stop(root);
      this.#collectEnding();
    }
    for (const execution of this.#instance.heap.objectsOf('execution')) {
      this.#instance.stop(execution);
    }
    this.#collectEnding();
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
    const target = startCall(this.#caller, callee, contents, captures);
    if (target.kind === 'answered') {
      resumeAfterCall(frame, target.value);
      return;
    }
    const { entry } = target;
    if (entry.code.async) {
      const future = this.#instance.futures.create({ kind: 'call' });
      this.#runStack.push(
        this.#instance.startExecution(entry, target.contents, target.captures, future),
      );
      return;
    }
    this.#runStack.pushFrame(newFrame(entry, target.contents, frame.heap, target.captures));
  }

  return(frame: ActiveFrame, value: Value): void {
    const execution = this.#runStack.popFrame(frame);
    releaseFrame(frame);
    if (this.#disposals.returned(execution, frame)) {
      return;
    }
    const returned = returnedValue(this.#instance, frame, value);
    const caller = execution.frames.at(-1);
    if (caller !== undefined) {
      resumeAfterCall(caller, returned);
      return;
    }
    if (this.#disposals.suspended(execution)) {
      return;
    }
    const future = execution.resolves;
    if (future === undefined) {
      this.#end = { finished: returned };
      return;
    }
    this.#instance.remove(execution);
    this.#instance.futures.resolve(future, returned);
    this.#leave(future, 'returned');
  }

  wait(frame: ActiveFrame): void {
    const execution = this.#runStack.current();
    if (this.#disposals.suspended(execution)) {
      return;
    }
    const instruction = frame.code.instructions[frame.pc];
    const awaited = instruction === undefined ? [] : awaitedRegisters(instruction);
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

  spawn(call: InstanceCall): string {
    return this.#instance.spawn(call);
  }

  guard(callback: Value): Value {
    const guard = this.#instance.heap.add((id) => ({ kind: 'guard', id, callback }));
    return handleTo(guard.id);
  }

  currentCall(): Value {
    return this.#instance.weak.reference(handleTo(this.#runStack.current().id));
  }

  /** Runs drivers until one awaits, the root returns, or nothing is ready. */
  #runDrivers(first: LiveExecution | undefined): RunEnd {
    this.#collectBeforeDriving();
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
        return { kind: 'finished', outcome: end.finished };
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
      if (this.#collected() && this.#end !== undefined) {
        return this.#end;
      }
      this.#step();
    }
  }

  /**
   * Collects what the segment let go of before any execution ran, as answers withdrawn from their
   * callers let go of what they wait on (§10).
   */
  #collectBeforeDriving(): void {
    this.#collectFully(() => this.#step());
  }

  /** Collects until no disposal's call is left to run, running each step of one with `step`. */
  #collectFully(step: () => void): void {
    while (!this.#collected()) {
      step();
    }
  }

  /** Collects what lost a holder since the last step; whether no disposal's call is left to run. */
  #collected(): boolean {
    const released = this.#instance.heap.takeReleased();
    if (released.length > 0) {
      this.#collector.collect(released);
    }
    return !this.#collector.busy;
  }

  /**
   * What holds things besides the collector's own rounds (lifetimes/holders.ts): every execution's
   * frames, the carrier's, the call futures of the executions running on the run stack, and the
   * answers still to give (§10). The frames running now come first, innermost first, as what code
   * lets go of is mostly held there.
   */
  #roots(): Roots {
    const running = this.#runStack.innermostFirst();
    const waiting = this.#instance.heap
      .objectsOf('execution')
      .filter((execution) => !running.includes(execution));
    return {
      frames: [...running, ...waiting].flatMap((execution) => execution.frames.toReversed()),
      objects: [...this.#runStack.callFutures(), ...this.#instance.answers()],
    };
  }

  /** Collects until no disposal is left to run, while the instance ends: one that panics is let go. */
  #collectEnding(): void {
    this.#collectFully(() => {
      try {
        this.#step();
      } catch (error) {
        if (panicOf(error) === undefined) {
          throw error;
        }
        this.#disposals.abandon();
      }
    });
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
    resumeAfterCall(topFrame(caller), handleTo(future));
  }
}
