/**
 * The calls runs make (proposal 8, Rule 5): a resolver's callback, readied as a run
 * (../instance/ready.ts), called as a driver of its own on a carrier execution, as a disposal's call
 * is when nothing runs (disposal-runs.ts). The carrier is never on the heap: a callback is a plain
 * function, so its call returns within the drive, and its return resolves nothing and ends the drive.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { newFrame } from '../../interpreter/machine.ts';
import type { LiveExecution, LiveObjectOf } from '../instance/heap.ts';
import { type Caller, runsAsExecution, startCall } from './calls.ts';
import type { RunStack } from './run-stack.ts';

export class RunCalls {
  readonly #runStack: RunStack;
  /** Runs a run's call; never in the heap, never persisted. */
  readonly #carrier: LiveExecution = {
    kind: 'execution',
    id: -2,
    resolves: undefined,
    frames: [],
    transients: [],
  };

  /** Calls made on the segment's `runStack`, which drives the carrier as any driver. */
  constructor(runStack: RunStack) {
    this.#runStack = runStack;
  }

  /**
   * Makes the call `run` readied from `caller`, a mock replacing its function asked first as for
   * any call: the carrier, its call's frame on it, to drive; none once it was answered at once.
   */
  start(caller: Caller, run: LiveObjectOf<'run'>): LiveExecution | undefined {
    const target = startCall(caller, run.function, run.arguments, run.captures);
    if (target.kind === 'answered') {
      return undefined;
    }
    if (runsAsExecution(target.entry)) {
      unreachable('A resolver calls back an async function.');
    }
    const heap = caller.instance.frameHeap;
    this.#carrier.frames.push(newFrame(target.entry, target.contents, heap, target.captures));
    return this.#carrier;
  }

  /**
   * Whether `execution`, whose last frame just returned, is the carrier, its run's call done: off
   * the run stack then, the drive over.
   */
  returned(execution: LiveExecution): boolean {
    if (execution !== this.#carrier) {
      return false;
    }
    this.#runStack.pop();
    return true;
  }
}
