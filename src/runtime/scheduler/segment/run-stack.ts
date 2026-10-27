/**
 * A segment's run stack (index.ts): the executions running on top of one another, the driver at
 * the bottom. An async callee runs on top of its caller until it awaits or returns, and a
 * disposal's code runs on top of whatever runs (disposal-runs.ts), so the stack, not JavaScript's,
 * holds every nested run. It is one unit both the runner and the disposals share, so what runs is
 * always its top.
 */

import type { Definition } from '../../../definition/definition.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { traceOf } from '../../interpreter/trace.ts';
import type { LiveExecution } from '../heap.ts';

export class RunStack {
  readonly #executions: LiveExecution[] = [];
  /** The execution the segment drives now, kept once it has left the stack at its await. */
  #driver: LiveExecution | undefined;

  /** Starts driving `driver`: it runs alone. */
  drive(driver: LiveExecution): void {
    this.#driver = driver;
    this.#executions.splice(0, this.#executions.length, driver);
  }

  push(execution: LiveExecution): void {
    this.#executions.push(execution);
  }

  /** Takes the top execution off; what runs next is the one under it, if any. */
  pop(): LiveExecution | undefined {
    this.#executions.pop();
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

  /**
   * Where every running frame is, innermost first (§3.12), without the innermost `leftOut`; once
   * the driver has stopped at its await, where it stopped.
   */
  trace(definition: Definition, leftOut = 0): string {
    const stack = this.#executions.length === 0 && this.#driver ? [this.#driver] : this.#executions;
    const frames = stack.toReversed().flatMap((execution) => execution.frames.toReversed());
    return traceOf(definition, frames.slice(leftOut));
  }
}
