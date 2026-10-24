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
 */

import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import { runInstruction } from '../interpreter/instructions.ts';
import {
  type ActiveFrame,
  type Machine,
  newFrame,
  readRegister,
  resumeAt,
} from '../interpreter/machine.ts';
import { traceOf } from '../interpreter/trace.ts';
import { type NativeContext, Panic } from '../natives.ts';
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

class SegmentRunner implements Machine {
  readonly #instance: Instance;
  readonly #startedAt: bigint;
  readonly #runStack: LiveExecution[] = [];
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
    } catch (error) {
      if (error instanceof Panic) {
        return { kind: 'panicked', message: error.message, trace: this.#trace() };
      }
      throw error;
    }
  }

  call(frame: ActiveFrame, callee: FunctionId, argumentList: readonly Argument[]): void {
    const values = argumentList.map((argument) => {
      if (argument.kind !== 'value') {
        throw new Error("The runtime doesn't pass references yet.");
      }
      return readRegister(frame, argument.register);
    });
    const callable = this.#instance.loaded.functions.callee(callee);
    if (callable.kind === 'native') {
      resumeAfterCall(frame, callable.native(values, this.#nativeContext(callee)));
      return;
    }
    if (callable.code.async) {
      const execution = this.#instance.startExecution(callable.function, values);
      this.#instance.newFuture({ kind: 'call', execution: execution.id });
      this.#runStack.push(execution);
      return;
    }
    this.#current().frames.push(newFrame(callable.function, callable.code, values));
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
    if (this.#instance.isResolved(readRegister(frame, future))) {
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
      const frame = topFrame(this.#current());
      const instruction = frame.code.instructions[frame.pc];
      if (instruction === undefined) {
        throw new RangeError(`pc ${frame.pc} is past the end; loading checks termination.`);
      }
      runInstruction(this, frame, instruction);
    }
    return this.#end;
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

  #nativeContext(callee: FunctionId): NativeContext {
    const entry = this.definition.functions[callee];
    if (entry === undefined) {
      throw new RangeError(`No function ${callee}; loading checks every index.`);
    }
    return {
      entry,
      segmentStartedAt: this.#startedAt,
      timer: (at) => this.#instance.newFuture({ kind: 'timer', at }),
      resolved: (value) => this.#instance.newFuture({ kind: 'resolved', value }),
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
