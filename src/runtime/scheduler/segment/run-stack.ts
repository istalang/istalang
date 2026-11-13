/**
 * A segment's run stack (index.ts): the executions running on top of one another, the driver at
 * the bottom. An async callee runs on top of its caller until it awaits or returns, and a
 * disposal's code runs on top of whatever runs (disposal-runs.ts), so the stack, not JavaScript's,
 * holds every nested run. It is one unit both the runner and the disposals share, so what runs is
 * always its top. Every frame push and pop goes through it, so the total frame count across the
 * stack stays exact and bounded (limits.ts). A running call holds its own future (§7), so every
 * push and pop of an execution is a holder write, reported as one
 * (runtime/lifetimes/holder-writes.ts).
 */

import type { Definition } from '../../../definition/definition.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/frames.ts';
import { callerTraceOf, traceOf } from '../../interpreter/trace.ts';
import type { HolderWrites } from '../../lifetimes/holder-writes.ts';
import type { Held } from '../../snapshot/holdings.ts';
import type { LiveExecution } from '../instance/heap.ts';
import { requireFrameDepth } from './limits.ts';

export class RunStack {
  readonly #holders: HolderWrites;
  readonly #executions: LiveExecution[] = [];
  /** The execution the segment drives now, kept once it has left the stack at its await. */
  #driver: LiveExecution | undefined;
  /** How many frames are running across every execution on the stack. */
  #frames = 0;

  constructor(holders: HolderWrites) {
    this.#holders = holders;
  }

  /** Starts driving `driver`: it runs alone. */
  drive(driver: LiveExecution): void {
    this.#driver = driver;
    const left = this.#executions.splice(0, this.#executions.length, driver);
    this.#frames = driver.frames.length;
    this.#holders.changed(futuresOf(left), futuresOf([driver]));
  }

  push(execution: LiveExecution): void {
    requireFrameDepth(this.#frames + execution.frames.length);
    this.#frames += execution.frames.length;
    this.#executions.push(execution);
    this.#holders.changed(futuresOf([]), futuresOf([execution]));
  }

  /** Pushes `frame` onto the running execution, guarding the segment's frame limit. */
  pushFrame(frame: ActiveFrame): void {
    requireFrameDepth(this.#frames + 1);
    this.#frames += 1;
    this.current().frames.push(frame);
  }

  /** Pops `frame`, the top frame of the running execution; that execution. */
  popFrame(frame: ActiveFrame): LiveExecution {
    const execution = this.current();
    if (execution.frames.pop() !== frame) {
      unreachable('Only the top frame returns.');
    }
    this.#frames -= 1;
    return execution;
  }

  /** Removes the frames of `execution` from `at` onward, innermost first. */
  dropFrames(execution: LiveExecution, at: number): readonly ActiveFrame[] {
    const dropped = execution.frames.splice(at);
    this.#frames -= dropped.length;
    return dropped.toReversed();
  }

  /**
   * Has a segment's trace, once nothing runs, show `execution`, stopped at its await, where the
   * driver handed its wait to; the driver's own without one.
   */
  stoppedIn(execution: LiveExecution | undefined): void {
    this.#driver = execution ?? this.#driver;
  }

  /** Takes the top execution off; what runs next is the one under it, if any. */
  pop(): LiveExecution | undefined {
    const popped = this.#executions.pop();
    this.#frames -= popped?.frames.length ?? 0;
    this.#holders.changed(futuresOf(popped === undefined ? [] : [popped]), futuresOf([]));
    return this.top();
  }

  /** The execution running now; undefined when none is. */
  top(): LiveExecution | undefined {
    return this.#executions.at(-1);
  }

  /** The execution running now, which there always is while an instruction runs. */
  current(): LiveExecution {
    const execution = this.top();
    if (execution === undefined) {
      unreachable('No execution is running.');
    }
    return execution;
  }

  /** Whether only the driver runs, so its await ends the segment. */
  get driverOnly(): boolean {
    return this.#executions.length === 1;
  }

  /** The running executions, innermost first. */
  innermostFirst(): readonly LiveExecution[] {
    return this.#executions.toReversed();
  }

  /** Where every running frame is, innermost first (§3.12). */
  trace(definition: Definition): string {
    return traceOf(definition, this.#framesInnermostFirst());
  }

  /** The trace of the code the running default gives its value to (`callerTraceOf`). */
  callerTrace(definition: Definition): string {
    return callerTraceOf(definition, this.#framesInnermostFirst());
  }

  /** The running frames, innermost first; once the driver has stopped at its await, its own. */
  #framesInnermostFirst(): readonly ActiveFrame[] {
    const stack = this.#executions.length === 0 && this.#driver ? [this.#driver] : this.#executions;
    return stack.toReversed().flatMap((execution) => execution.frames.toReversed());
  }
}

/** What `executions` hold while they run: their call futures (§7). */
function futuresOf(executions: readonly LiveExecution[]): Held {
  return { values: [], holds: executions.flatMap(({ resolves }) => resolves ?? []) };
}
