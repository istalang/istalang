/**
 * What a running instance has ready to run, in the order it became ready (§6): waiters whose wait
 * was decided, and runs, the calls resolvers readied (proposal 8, Rule 5).
 *
 * - A run is a root object holding a callback's function and arguments (snapshot/objects.ts), so
 *   what it calls with is committed while it waits its turn, and a segment a crash discards readied
 *   nothing. Taking it off the queue takes it off the heap: the segment reaching it makes the call.
 * - A waiter is moved past its wait as it is taken, its decision read off the wait (waits.ts).
 * - An instance that ends (§3.12) runs nothing more: closing the queue drops its runs, so what they
 *   would have called with is let go of and disposed with the rest, and readies none after.
 */

import { closureOf, type Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { resume } from '../../interpreter/suspension.ts';
import type { Heap, LiveExecution, LiveObjectOf } from './heap.ts';
import type { Waits } from './waits.ts';

/** What is ready taken off the queue: a waiter moved past its wait, or a run whose call to make. */
export type ReadyToRun = LiveExecution | LiveObjectOf<'run'>;

export class ReadyQueue {
  readonly #heap: Heap;
  readonly #ids: number[];
  /** Whether a run is readied or, once the instance ends, dropped. */
  #runs: 'readied' | 'dropped' = 'readied';

  /** The queue of `heap` holding `ids`, as a snapshot lists them. */
  constructor(heap: Heap, ids: readonly number[]) {
    this.#heap = heap;
    this.#ids = [...ids];
  }

  /** What is ready, in order, as a snapshot stores it. */
  get ids(): readonly number[] {
    return this.#ids;
  }

  /** Whether nothing is ready. */
  get idle(): boolean {
    return this.#ids.length === 0;
  }

  /** Queues `waiter`, its wait decided, which it is once. */
  waiter(waiter: LiveExecution): void {
    this.#ids.push(waiter.id);
  }

  /** Queues a call of the function value `callback` with `argumentValues` as a run, unless closed. */
  run(callback: Value, argumentValues: readonly Value[]): void {
    if (this.#runs === 'dropped') {
      return;
    }
    const closure =
      closureOf(callback) ?? unreachable('A resolver calls back what is no function value.');
    const run = this.#heap.add(
      (id): LiveObjectOf<'run'> => ({
        kind: 'run',
        id,
        function: closure.function,
        captures: closure.captures,
        arguments: [...argumentValues],
      }),
    );
    this.#ids.push(run.id);
  }

  /** Drops every run, and readies none from now on: the instance ends. */
  close(): void {
    this.#runs = 'dropped';
    for (const run of this.#heap.objectsOf('run')) {
      this.withdraw(run);
      this.#heap.remove(run.id);
    }
  }

  /** Takes `ready` off the queue, if it is on it: an execution stops, or resumes otherwise. */
  withdraw(ready: ReadyToRun): void {
    const position = this.#ids.indexOf(ready.id);
    if (position >= 0) {
      this.#ids.splice(position, 1);
    }
  }

  /** The next ready: a waiter moved past its wait with `waits`, or a run, off the heap. */
  next(waits: Waits): ReadyToRun | undefined {
    const id = this.#ids.shift();
    if (id === undefined) {
      return undefined;
    }
    const ready = this.#heap.objectOf(id);
    if (ready.kind === 'run') {
      this.#heap.remove(id);
      return ready;
    }
    const execution = this.#heap.of(id, 'execution');
    const top = execution.frames.at(-1) ?? unreachable(`Execution ${id} has no frame.`);
    resume(top, waits.take(execution));
    return execution;
  }
}
