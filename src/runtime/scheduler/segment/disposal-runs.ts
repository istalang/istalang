/**
 * The code disposals run (§7), on a segment's run stack (index.ts), and how each tells the
 * collector it is done, so the round waiting on it goes on.
 *
 * - A disposal's call runs as a frame on top of whatever runs, or on a carrier execution of its
 *   own when nothing does, as when a driver's await or return let go of things. Its return resumes
 *   collecting, not a caller.
 * - A disposed call's cleanup is that call's own execution, resumed on its `disposing()` watcher,
 *   that case winning whatever else has resolved. Its next await or return stops the call there.
 * - While an instance ends (§3.12), a disposal that panics is abandoned with whatever it started,
 *   so it counts as done and the rest still run and tell their hosts.
 * - A disposal's call is a call like any other to a mock that replaces it (§10).
 */

import { handleTarget } from '../../../definition/values/values.ts';
import { type ActiveFrame, newFrame, releaseFrame } from '../../interpreter/machine.ts';
import { resume } from '../../interpreter/suspension.ts';
import type { Cleanup, DisposalCall, DisposalRun } from '../../lifetimes/disposal.ts';
import type { LiveExecution } from '../instance/heap.ts';
import { type Instance, topFrame } from '../instance/index.ts';
import { type Caller, startCall } from './calls.ts';
import type { RunStack } from './run-stack.ts';

export interface DisposalRunSeams {
  readonly instance: Instance;
  /** Who the segment's calls are made by, which a call to another instance's mock carries. */
  readonly caller: Caller;
  /** The segment's run stack, shared with it: what runs is its top. */
  readonly runStack: RunStack;
  /** Tells the collector that the disposal its innermost round waits on is done. */
  readonly returned: () => void;
}

export class DisposalRuns {
  readonly #seams: DisposalRunSeams;
  /** Frames running a disposal's call. */
  readonly #frames = new WeakSet<ActiveFrame>();
  /** Disposed calls running their cleanup. */
  readonly #cleanups = new WeakSet<LiveExecution>();
  /** Runs disposal calls when no execution is running; never in the heap, never persisted. */
  readonly #carrier: LiveExecution = {
    kind: 'execution',
    id: -1,
    resolves: undefined,
    frames: [],
    disposing: false,
  };

  constructor(seams: DisposalRunSeams) {
    this.#seams = seams;
  }

  /** Starts `run`: true once it is done already (a native), false while its code runs. */
  start(run: DisposalRun): boolean {
    return run.kind === 'call' ? this.#call(run) : this.#cleanup(run);
  }

  /** `frame` just returned off `execution`: whether it ran a disposal's call, which is now done. */
  returned(execution: LiveExecution, frame: ActiveFrame): boolean {
    if (!this.#frames.has(frame)) {
      return false;
    }
    this.#callDone(execution);
    return true;
  }

  /** `execution` awaited or returned: whether it ran a cleanup, which stops the call there. */
  suspended(execution: LiveExecution): boolean {
    if (!this.#cleanups.has(execution)) {
      return false;
    }
    this.#seams.runStack.pop();
    this.#seams.instance.stop(execution);
    this.#seams.returned();
    return true;
  }

  /**
   * Lets go of the innermost disposal, which panicked while the instance ends: its call's frames,
   * or its cleanup's execution, and any execution an async call in it started on top.
   */
  abandon(): void {
    const { runStack, instance } = this.#seams;
    for (let execution = runStack.top(); execution !== undefined; execution = runStack.top()) {
      const { frames } = execution;
      const at = frames.findLastIndex((frame) => this.#frames.has(frame));
      if (at >= 0) {
        for (const frame of runStack.dropFrames(execution, at)) {
          releaseFrame(frame);
        }
        this.#callDone(execution);
        return;
      }
      if (this.suspended(execution)) {
        return;
      }
      runStack.pop();
      instance.stop(execution);
    }
  }

  #call(call: DisposalCall): boolean {
    const { instance, caller, runStack } = this.#seams;
    const target = startCall(caller, call.function, call.arguments, call.captures);
    if (target.kind === 'answered') {
      return true;
    }
    const frame = newFrame(target.entry, target.contents, instance.frameHeap, target.captures);
    this.#frames.add(frame);
    if (runStack.top() === undefined) {
      runStack.push(this.#carrier);
    }
    runStack.pushFrame(frame);
    return false;
  }

  /** A disposal's call, on `execution`, is done: the carrier leaves the run stack once empty. */
  #callDone(execution: LiveExecution): void {
    if (execution === this.#carrier && execution.frames.length === 0) {
      this.#seams.runStack.pop();
    }
    this.#seams.returned();
  }

  #cleanup({ execution, watcher }: Cleanup): false {
    this.#seams.instance.unready(execution);
    resume(topFrame(execution), (handle) =>
      handleTarget(handle) === watcher ? { value: null } : undefined,
    );
    this.#cleanups.add(execution);
    this.#seams.runStack.push(execution);
    return false;
  }
}
