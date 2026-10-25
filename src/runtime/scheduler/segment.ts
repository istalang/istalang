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
 */

import { awaitedRegisters } from '../../definition/instructions/flow.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { depthOf, handleTarget, maximumDepth, type Value } from '../../definition/values.ts';
import { runInstruction } from '../interpreter/instructions.ts';
import {
  type ActiveFrame,
  argumentContents,
  type CellStore,
  type Machine,
  newFrame,
  type RegisterContents,
  readRegister,
  readThrough,
  resumeAt,
  writeReference,
} from '../interpreter/machine.ts';
import { traceOf } from '../interpreter/trace.ts';
import { type NativeCells, type NativeContext, Panic } from '../natives.ts';
import { isReference, type Reference } from '../snapshot/objects.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';
import type { LiveExecution } from './heap.ts';
import { type Instance, topFrame } from './instance.ts';

export type SegmentEnd =
  /** A driver awaited: commit, then run the next segment. */
  | { readonly kind: 'awaited' }
  /** Nothing is ready: commit, then wait. */
  | { readonly kind: 'idle' }
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

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #startedAt: bigint;
  readonly #nativeCells: NativeCells;
  readonly #runStack: LiveExecution[] = [];
  #end: DriveEnd | undefined;

  constructor(instance: Instance, startedAt: bigint) {
    this.#instance = instance;
    this.#startedAt = startedAt;
    this.#nativeCells = nativeCellsOf(instance.cells);
  }

  get definition() {
    return this.#instance.loaded.definition;
  }

  run(first: LiveExecution | undefined): SegmentEnd {
    try {
      const end = this.#runDrivers(first);
      this.#requirePersistable(end);
      return end;
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
      const values = contents.map((each) =>
        isReference(each) ? readThrough(frame.cells, each) : each,
      );
      const result = callable.native(values, {
        ...this.#nativeContext(callee),
        write: (position, value) =>
          writeReference(frame.cells, referenceAt(contents, position), value),
      });
      resumeAfterCall(frame, result);
      return;
    }
    if (callable.code.async) {
      const future = this.#instance.futures.create({ kind: 'call' });
      this.#runStack.push(
        this.#instance.startExecution(callable.function, contents, captures, future),
      );
      return;
    }
    const calleeFrame = newFrame(callable, contents, frame.cells, captures);
    this.#current().frames.push(calleeFrame);
  }

  return(frame: ActiveFrame, value: Value): void {
    const execution = this.#current();
    if (execution.frames.pop() !== frame) {
      throw new Error('Only the top frame returns.');
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

  /** Runs drivers until one awaits, the root returns, or nothing is ready. */
  #runDrivers(first: LiveExecution | undefined): Exclude<SegmentEnd, { kind: 'panicked' }> {
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

  /** Panics when what `end` leaves holds a value too deep to persist (§5). */
  #requirePersistable(end: Exclude<SegmentEnd, { kind: 'panicked' }>): void {
    const depth = end.kind === 'finished' ? depthOf(end.outcome) : this.#instance.deepestValue();
    if (depth > maximumDepth) {
      throw new Panic(
        `A value nests ${depth} levels deep, deeper than the ${maximumDepth} an instance can persist.`,
      );
    }
  }

  /** Runs `driver` until it awaits or returns. */
  #drive(driver: LiveExecution): DriveEnd {
    this.#runStack.splice(0, this.#runStack.length, driver);
    this.#end = undefined;
    while (this.#end === undefined) {
      this.#step();
    }
    return this.#end;
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

  #nativeContext(callee: FunctionId): Omit<NativeContext, 'write'> {
    const entry = this.definition.functions[callee];
    if (entry === undefined) {
      throw new RangeError(`No function ${callee}; loading checks every index.`);
    }
    return {
      entry,
      types: this.definition.types,
      segmentStartedAt: this.#startedAt,
      timer: (at) => this.#instance.futures.createHandle({ kind: 'timer', at }),
      resolved: (value) => this.#instance.futures.createHandle({ kind: 'resolved', value }),
      first: (futures) => this.#instance.futures.first(futures),
      slots: {
        create: () => this.#instance.slots.create(),
        operate: (slot, operation, value) => this.#instance.slots.operate(slot, operation, value),
      },
      trace: () => this.#trace(),
      cells: this.#nativeCells,
    };
  }

  /** Where every running frame is, innermost first (§3.12). */
  #trace(): string {
    const frames = this.#runStack
      .toReversed()
      .flatMap((execution) => execution.frames.toReversed());
    return traceOf(this.definition, frames);
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

/** The reference a native's argument `position` was passed by `&`. */
function referenceAt(contents: readonly RegisterContents[], position: number): Reference {
  const argument = contents[position];
  if (argument === undefined || !isReference(argument)) {
    throw new Error(`A native wrote argument ${position}, which isn't passed by '&'.`);
  }
  return argument;
}

/** The instance's cells as natives reach them: through `Shared<T>` handles (§3.8). */
function nativeCellsOf(cells: CellStore): NativeCells {
  return {
    create: (type, value) => ({ kind: 'handle', object: cells.create(type, value) }),
    read: (cell) => cells.read(cellIdOf(cell)),
    write: (cell, value) => {
      cells.write(cellIdOf(cell), value);
    },
  };
}

function cellIdOf(cell: Value): number {
  const id = handleTarget(cell);
  if (id === undefined) {
    throw new TypeError('A Shared value holds no cell.');
  }
  return id;
}
