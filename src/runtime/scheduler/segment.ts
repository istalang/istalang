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
 * What a segment leaves is persisted when it commits, and a persisted value nests at most
 * `maximumDepth` levels (definition/values.ts). A segment leaving a deeper value, where an
 * execution can reach it or as its outcome, panics where it ended instead, so it commits nothing.
 *
 * After every instruction that let go of something, the segment collects (runtime/lifetimes/):
 * what lost its last holder is disposed right there (§7). A disposal that runs code is a call on
 * the run stack like any other, pushed on whatever runs, or on a carrier execution of its own when
 * nothing does, as when a driver's await or return let go of things. A drive ends only once
 * collecting has. An execution running on the run stack holds its own call future, so code that
 * lets go of the last holder of its own call runs on until it suspends, and is stopped there.
 */

import { awaitedRegisters } from '../../definition/instructions/flow.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { depthOf, maximumDepth, type Value } from '../../definition/values.ts';
import { runInstruction } from '../interpreter/instructions.ts';
import {
  type ActiveFrame,
  argumentContents,
  type Machine,
  newFrame,
  readRegister,
  releaseFrame,
  resumeAt,
} from '../interpreter/machine.ts';
import { traceOf } from '../interpreter/trace.ts';
import { Collector } from '../lifetimes/collector.ts';
import type { DisposalCall } from '../lifetimes/disposal.ts';
import type { Roots } from '../lifetimes/holders.ts';
import { Panic } from '../natives.ts';
import type { HeapObject } from '../snapshot/objects.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';
import type { LiveExecution } from './heap.ts';
import { type Instance, topFrame } from './instance.ts';
import { NativeCalls } from './native-calls.ts';

export type SegmentEnd =
  /** A driver awaited: commit `objects`, then run the next segment. */
  | { readonly kind: 'awaited'; readonly objects: readonly HeapObject[] }
  /** Nothing is ready: commit `objects`, then wait. */
  | { readonly kind: 'idle'; readonly objects: readonly HeapObject[] }
  | { readonly kind: 'finished'; readonly outcome: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };

/**
 * Runs one segment of `instance`, which started at `startedAt`. `driver` is an execution about to
 * run from its start; without one, the segment begins with the next ready execution.
 */
export function runSegment(
  instance: Instance,
  startedAt: bigint,
  driver?: LiveExecution,
): SegmentEnd {
  return new SegmentRunner(instance, startedAt).run(driver);
}

/** How driving one execution ended. */
type DriveEnd = 'awaited' | 'returned' | { readonly finished: Value };

/** How a segment ended before what it leaves is checked for persisting. */
type RunEnd = { readonly kind: 'awaited' | 'idle' } | Extract<SegmentEnd, { kind: 'finished' }>;

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #natives: NativeCalls;
  readonly #runStack: LiveExecution[] = [];
  readonly #collector: Collector;
  /** Frames running a disposal's call: their return resumes collecting, not a caller. */
  readonly #disposalFrames = new WeakSet<ActiveFrame>();
  /** Runs disposal calls when no execution is running; never in the heap, never persisted. */
  readonly #carrier: LiveExecution = {
    kind: 'execution',
    id: -1,
    resolves: undefined,
    frames: [],
    disposing: false,
  };
  #driver: LiveExecution | undefined;
  #end: DriveEnd | undefined;

  constructor(instance: Instance, startedAt: bigint) {
    this.#instance = instance;
    this.#natives = new NativeCalls(instance, startedAt, () => this.#trace());
    this.#collector = new Collector({
      heap: instance.heap,
      types: instance.loaded.definition.types,
      roots: () => this.#roots(),
      stop: (execution) => {
        instance.stop(execution);
      },
      run: (call) => this.#runDisposal(call),
    });
  }

  get definition() {
    return this.#instance.loaded.definition;
  }

  run(first: LiveExecution | undefined): SegmentEnd {
    try {
      return this.#persistable(this.#runDrivers(first));
    } catch (error) {
      if (error instanceof Panic) {
        return { kind: 'panicked', message: error.message, trace: this.#trace() };
      }
      throw error;
    }
  }

  call(
    frame: ActiveFrame,
    callee: FunctionId,
    argumentList: readonly Argument[],
    captures: readonly Value[] = [],
  ): void {
    const contents = argumentList.map((argument) => argumentContents(frame, argument));
    const callable = this.#instance.loaded.functions.callee(callee);
    if (callable.kind === 'native') {
      resumeAfterCall(frame, this.#natives.call(callee, callable.native, contents));
      return;
    }
    if (callable.code.async) {
      const future = this.#instance.futures.create({ kind: 'call' });
      this.#runStack.push(
        this.#instance.startExecution(callable.function, contents, captures, future),
      );
      return;
    }
    const calleeFrame = newFrame(callable, contents, frame.heap, captures);
    this.#current().frames.push(calleeFrame);
  }

  return(frame: ActiveFrame, value: Value): void {
    const execution = this.#current();
    if (execution.frames.pop() !== frame) {
      throw new Error('Only the top frame returns.');
    }
    releaseFrame(frame);
    if (this.#disposalFrames.has(frame)) {
      if (execution === this.#carrier && execution.frames.length === 0) {
        this.#runStack.pop();
      }
      this.#collector.returned();
      return;
    }
    const caller = execution.frames.at(-1);
    if (caller !== undefined) {
      resumeAfterCall(caller, value);
      return;
    }
    const future = execution.resolves;
    if (future === undefined) {
      this.#end = { finished: value };
      return;
    }
    this.#instance.remove(execution);
    this.#instance.futures.resolve(future, value);
    this.#leave(future, 'returned');
  }

  wait(frame: ActiveFrame): void {
    const execution = this.#current();
    const instruction = frame.code.instructions[frame.pc];
    const awaited = instruction === undefined ? [] : awaitedRegisters(instruction);
    if (awaited.some((register) => this.settled(readRegister(frame, register)) !== undefined)) {
      this.#instance.markReady(execution);
    }
    if (this.#runStack.length === 1) {
      this.#runStack.pop();
      this.#instance.heap.noteReleased(
        execution.resolves === undefined ? [] : [execution.resolves],
      );
      this.#end = 'awaited';
      return;
    }
    if (execution.resolves === undefined) {
      throw new Error(`Execution ${execution.id} runs on top of another without a call future.`);
    }
    this.#leave(execution.resolves, 'awaited');
  }

  readonly settled = (handle: Value): { readonly value: Value } | undefined =>
    this.#instance.futures.settled(handle);

  spawn(call: InstanceCall): void {
    this.#instance.spawn(call);
  }

  guard(callback: Value): Value {
    const guard = this.#instance.heap.add((id) => ({ kind: 'guard', id, callback }));
    return { kind: 'handle', object: guard.id };
  }

  /** Runs drivers until one awaits, the root returns, or nothing is ready. */
  #runDrivers(first: LiveExecution | undefined): RunEnd {
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
    this.#driver = driver;
    this.#runStack.splice(0, this.#runStack.length, driver);
    this.#end = undefined;
    for (;;) {
      const released = this.#instance.heap.takeReleased();
      if (released.length > 0) {
        this.#collector.collect(released);
      }
      if (this.#end !== undefined && !this.#collector.busy) {
        return this.#end;
      }
      this.#step();
    }
  }

  /**
   * What holds things besides the collector's own rounds: every execution's frames, the carrier's,
   * and the call futures of the executions running on the run stack (lifetimes/holders.ts). The
   * frames running now come first, innermost first, as what code lets go of is mostly held there.
   */
  #roots(): Roots {
    const running = this.#runStack.toReversed();
    const waiting = this.#instance.heap
      .objectsOf('execution')
      .filter((execution) => !running.includes(execution));
    return {
      frames: [...running, ...waiting].flatMap((execution) => execution.frames.toReversed()),
      objects: this.#runStack.flatMap(({ resolves }) => (resolves === undefined ? [] : [resolves])),
    };
  }

  /**
   * Starts a disposal's call: a native at once, true once done; code as a frame on top of what
   * runs, or on the carrier when nothing does, false until it returns (`return`).
   */
  #runDisposal(call: DisposalCall): boolean {
    const callable = this.#instance.loaded.functions.callee(call.function);
    if (callable.kind === 'native') {
      this.#natives.call(call.function, callable.native, call.arguments);
      return true;
    }
    const frame = newFrame(callable, call.arguments, this.#instance.frameHeap, call.captures);
    this.#disposalFrames.add(frame);
    if (this.#runStack.length === 0) {
      this.#runStack.push(this.#carrier);
    }
    this.#current().frames.push(frame);
    return false;
  }

  /** Runs the instruction the top frame stands at. */
  #step(): void {
    const frame = topFrame(this.#current());
    const instruction = frame.code.instructions[frame.pc];
    if (instruction === undefined) {
      throw new RangeError(`pc ${frame.pc} is past the end; loading checks termination.`);
    }
    runInstruction(this, frame, instruction);
  }

  /**
   * Takes the top execution, which just awaited or returned, off the run stack. The execution
   * under it receives the call's future; with none under it, the driver's run ends with `end`.
   */
  #leave(future: number, end: 'awaited' | 'returned'): void {
    this.#runStack.pop();
    const caller = this.#runStack.at(-1);
    if (caller === undefined) {
      this.#end = end;
      return;
    }
    resumeAfterCall(topFrame(caller), { kind: 'handle', object: future });
  }

  #current(): LiveExecution {
    const execution = this.#runStack.at(-1);
    if (execution === undefined) {
      throw new Error('No execution is running.');
    }
    return execution;
  }

  /**
   * Where every running frame is, innermost first (§3.12); once the driver has stopped at its
   * await, where it stopped.
   */
  #trace(): string {
    const stack = this.#runStack.length === 0 && this.#driver ? [this.#driver] : this.#runStack;
    const frames = stack.toReversed().flatMap((execution) => execution.frames.toReversed());
    return traceOf(this.definition, frames);
  }
}

/** Panics when a value nesting `depth` levels is too deep to persist (§5). */
function requireDepth(depth: number): void {
  if (depth > maximumDepth) {
    throw new Panic(
      `A value nests ${depth} levels deep, deeper than the ${maximumDepth} an instance can persist.`,
    );
  }
}

/** Writes a call's result into the `call` that `frame` stopped at, and moves past it. */
function resumeAfterCall(frame: ActiveFrame, value: Value): void {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'call') {
    throw new Error(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a call.`);
  }
  resumeAt(frame, instruction.dst, value);
}
