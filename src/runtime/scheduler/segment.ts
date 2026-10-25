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
 * other execution stands at an `await`, as a snapshot requires.
 *
 * Reading or writing an element of a place calls its container's `index` or `setIndex` (values/
 * parts.ts) in the middle of an instruction. Such a call runs to completion at once: a native
 * directly, and a function of the program on top of the running frame, in a loop of its own until
 * it returns. It can't wait, since only an async function awaits, and both the checker and
 * loading refuse an async `index` or `setIndex` for a place. The container it
 * takes by `&` is a box (parts.ts), which the callee's frames reach as a cell of their own. Such
 * calls nest on the JavaScript stack, so their depth is bounded (`maximumNesting`).
 */

import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
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
import { type NativeContext, Panic } from '../natives.ts';
import { isReference, type Reference } from '../snapshot/objects.ts';
import { type Box, type ElementCalls, isBox } from '../values/parts.ts';
import { type Instance, type LiveExecution, topFrame } from './instance.ts';

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

/**
 * How many calls may run inside one another from inside places. Each runs on the JavaScript stack,
 * so a program's own `index` or `setIndex` recursing through a deep structure would otherwise
 * overflow it; past the bound the instance panics, as any bug in the program does (§3.12).
 */
const maximumNesting = 200;

/** A call running to completion inside an instruction: its frame, and its result once it returns. */
interface NestedCall {
  readonly frame: ActiveFrame;
  result?: { readonly value: Value };
}

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #startedAt: bigint;
  readonly #runStack: LiveExecution[] = [];
  readonly #nested: NestedCall[] = [];
  #end: DriveEnd | undefined;

  constructor(instance: Instance, startedAt: bigint) {
    this.#instance = instance;
    this.#startedAt = startedAt;
  }

  get definition() {
    return this.#instance.loaded.definition;
  }

  run(first: LiveExecution | undefined): SegmentEnd {
    try {
      for (
        let driver = first ?? this.#instance.resumeNext(this);
        driver !== undefined;
        driver = this.#instance.resumeNext(this)
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
    } catch (error) {
      if (error instanceof Panic) {
        return { kind: 'panicked', message: error.message, trace: this.#trace() };
      }
      throw error;
    }
  }

  call(frame: ActiveFrame, callee: FunctionId, argumentList: readonly Argument[]): void {
    const contents = argumentList.map((argument) => argumentContents(frame, argument, this));
    const callable = this.#instance.loaded.functions.callee(callee);
    if (callable.kind === 'native') {
      const values = contents.map((each) =>
        isReference(each) ? readThrough(frame.cells, each, this) : each,
      );
      const result = callable.native(values, {
        ...this.#nativeContext(callee),
        write: (position, value) =>
          writeReference(frame.cells, referenceAt(contents, position), value, this),
      });
      resumeAfterCall(frame, result, this);
      return;
    }
    if (callable.code.async) {
      if (contents.some((each) => isReference(each) && each.cell < 0)) {
        throw new Error("A container's 'setIndex' can't pass it by '&' to an async function.");
      }
      const execution = this.#instance.startExecution(callable.function, contents);
      this.#instance.newFuture({ kind: 'call', execution: execution.id });
      this.#runStack.push(execution);
      return;
    }
    const calleeFrame = newFrame(callable.function, callable.code, contents, frame.cells);
    this.#current().frames.push(calleeFrame);
  }

  callNow(callee: FunctionId, argumentList: readonly (Value | Box)[]): Value {
    const callable = this.#instance.loaded.functions.callee(callee);
    if (callable.kind === 'native') {
      const values = argumentList.map((each) => (isBox(each) ? each.value : each));
      return callable.native(values, {
        ...this.#nativeContext(callee),
        write: (position, value) => {
          boxAt(argumentList, position).value = value;
        },
      });
    }
    if (callable.code.async) {
      throw new Error(`'${callable.code.name}' is async, so it can't run inside a place.`);
    }
    if (this.#nested.length >= maximumNesting) {
      throw new Panic(
        `Elements nest too deeply: an 'index' or 'setIndex' ran inside ${maximumNesting} others.`,
      );
    }
    const execution = this.#current();
    const cells = boxedCells(topFrame(execution).cells, argumentList);
    const contents = argumentList.map((each, position) =>
      isBox(each) ? { kind: 'reference' as const, cell: boxCell(position), path: [] } : each,
    );
    const nested: NestedCall = {
      frame: newFrame(callable.function, callable.code, contents, cells),
    };
    execution.frames.push(nested.frame);
    this.#nested.push(nested);
    try {
      while (nested.result === undefined) {
        this.#step();
      }
    } finally {
      this.#nested.pop();
    }
    return nested.result.value;
  }

  return(frame: ActiveFrame, value: Value): void {
    const execution = this.#current();
    if (execution.frames.pop() !== frame) {
      throw new Error('Only the top frame returns.');
    }
    const nested = this.#nested.at(-1);
    if (nested?.frame === frame) {
      nested.result = { value };
      return;
    }
    const caller = execution.frames.at(-1);
    if (caller !== undefined) {
      resumeAfterCall(caller, value, this);
      return;
    }
    const future = this.#instance.callFutureOf(execution);
    if (future === undefined) {
      this.#end = { finished: value };
      return;
    }
    this.#instance.remove(execution);
    this.#instance.resolve(future, value);
    this.#leave(future, 'returned');
  }

  await(frame: ActiveFrame, future: Register): void {
    const execution = this.#current();
    if (this.#instance.isResolved(readRegister(frame, future, this))) {
      this.#instance.markReady(execution);
    }
    if (this.#runStack.length === 1) {
      this.#end = 'awaited';
      return;
    }
    const own = this.#instance.callFutureOf(execution);
    if (own === undefined) {
      throw new Error(`Execution ${execution.id} runs on top of another without a call future.`);
    }
    this.#leave(own, 'awaited');
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
    resumeAfterCall(topFrame(caller), { kind: 'handle', object: future }, this);
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
      timer: (at) => this.#instance.newFuture({ kind: 'timer', at }),
      resolved: (value) => this.#instance.newFuture({ kind: 'resolved', value }),
      trace: () => this.#trace(),
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
function resumeAfterCall(frame: ActiveFrame, value: Value, calls: ElementCalls): void {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'call') {
    throw new Error(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a call.`);
  }
  resumeAt(frame, instruction.dst, value, calls);
}

/** The reference a native's argument `position` was passed by `&`. */
function referenceAt(contents: readonly RegisterContents[], position: number): Reference {
  const argument = contents[position];
  if (argument === undefined || !isReference(argument)) {
    throw new Error(`A native wrote argument ${position}, which isn't passed by '&'.`);
  }
  return argument;
}

/** The box a call made inside a place passes at `position`. */
function boxAt(argumentList: readonly (Value | Box)[], position: number): Box {
  const argument = argumentList[position];
  if (argument === undefined || !isBox(argument)) {
    throw new Error(`A native wrote argument ${position}, which isn't passed by '&'.`);
  }
  return argument;
}

/** The cell a box at `position` is to the callee's frames: below every cell of the instance. */
function boxCell(position: number): number {
  return -1 - position;
}

/** `cells`, plus the boxes of `argumentList` as cells of their own (`boxCell`). */
function boxedCells(cells: CellStore, argumentList: readonly (Value | Box)[]): CellStore {
  const boxOf = (cell: number) => boxAt(argumentList, -1 - cell);
  return {
    read: (cell) => (cell < 0 ? boxOf(cell).value : cells.read(cell)),
    write: (cell, value) => {
      if (cell < 0) {
        boxOf(cell).value = value;
      } else {
        cells.write(cell, value);
      }
    },
    create: (type, value) => cells.create(type, value),
  };
}
