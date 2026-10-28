/**
 * A segment's run stack (index.ts): the executions running on top of one another, the driver at
 * the bottom. An async callee runs on top of its caller until it awaits or returns, and a
 * disposal's code runs on top of whatever runs (disposal-runs.ts), so the stack, not JavaScript's,
 * holds every nested run. It is one unit both the runner and the disposals share, so what runs is
 * always its top. Every frame push and pop goes through it, so the total frame count across the
 * stack stays exact and bounded (limits.ts).
 */

import type { Definition } from '../../../definition/definition.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ActiveFrame } from '../../interpreter/machine.ts';
import { callerTraceOf, traceOf } from '../../interpreter/trace.ts';
import type { LiveExecution } from '../heap.ts';
import { requireFrameDepth } from './limits.ts';

export class RunStack {
  readonly #executions: LiveExecution[] = [];
  /** The execution the segment drives now, kept once it has left the stack at its await. */
  #driver: LiveExecution | undefined;
  /** How many frames are running across every execution on the stack. */
  #frames = 0;

  /** Starts driving `driver`: it runs alone. */
  drive(driver: LiveExecution): void {
    this.#driver = driver;
    this.#executions.splice(0, this.#executions.length, driver);
    this.#frames = driver.frames.length;
  }

  push(execution: LiveExecution): void {
    requireFrameDepth(this.#frames + execution.frames.length);
    this.#frames += execution.frames.length;
    this.#executions.push(execution);
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

  /** Takes the top execution off; what runs next is the one under it, if any. */
  pop(): LiveExecution | undefined {
    const popped = this.#executions.pop();
    this.#frames -= popped?.frames.length ?? 0;
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

  /** The call futures of the executions running, which each holds while it runs (§7). */
  callFutures(): readonly number[] {
    return this.#executions.flatMap(({ resolves }) => resolves ?? []);
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
