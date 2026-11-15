/**
 * A segment's collecting (runtime/lifetimes/): at the end of every step, what lost its last holder
 * during it is disposed right there (§7), and a drive ends only once collecting has. A disposal
 * that runs code runs on the segment's run stack as any call does (disposal-runs.ts), each of its
 * steps the segment's own, so collecting is handed the step to take. A slot's queue whose serving
 * paused for collecting (slots.ts) is served once it is done, before anything else runs. A test
 * runtime checks the heap after every step that let go of or wrote into something, before
 * collecting, while what is to be collected is still there (`LoadedDefinition.heapCheck`).
 */

import type { ActiveFrame } from '../../interpreter/frames.ts';
import { Collector } from '../../lifetimes/collector.ts';
import { panicOf } from '../../natives.ts';
import type { LiveExecution } from '../instance/heap.ts';
import { type DisposalRunSeams, DisposalRuns } from './disposal-runs.ts';

/** What a segment's collecting reads: its instance, its run stack, the caller of its calls. */
type CollectionSeams = Omit<DisposalRunSeams, 'returned' | 'abandoned'>;

export class SegmentCollection {
  readonly #seams: CollectionSeams;
  readonly #collector: Collector;
  /** The code disposals run, on the segment's run stack. */
  readonly disposals: DisposalRuns;

  constructor(seams: CollectionSeams) {
    this.#seams = seams;
    const { instance } = seams;
    this.disposals = new DisposalRuns({
      ...seams,
      returned: () => {
        this.#collector.returned();
      },
      abandoned: () => {
        this.#collector.abandoned();
      },
    });
    this.#collector = new Collector({
      heap: instance.heap,
      holders: instance.holders,
      types: instance.loaded.definition.types,
      stop: (execution) => {
        instance.stop(execution);
      },
      cleanupCase: (execution) => instance.waits.cleanupCase(execution),
      weak: instance.weak,
      disposed: (id) => {
        instance.notices.disposed(id);
      },
      cancel: (resolver) => {
        instance.waits.cancel(resolver);
      },
      run: (run) => this.disposals.start(run),
    });
  }

  /**
   * Collects what lost its last holder by the end of the step, then serves the slots' queues whose
   * serving waited for it, as long as that lets go of more; whether no disposal's call is left to
   * run.
   */
  collected(): boolean {
    const { heap, holders, slots, loaded } = this.#seams.instance;
    for (;;) {
      const changed = new Set([...holders.takeLetGo(), ...heap.takeWritten()]);
      if (changed.size > 0) {
        const running = new Set(this.#seams.runStack.innermostFirst().map(({ id }) => id));
        loaded.heapCheck.changed({ heap, types: loaded.definition.types }, [...changed], running);
      }
      this.#collector.collect();
      if (this.#collector.busy) {
        return false;
      }
      if (!slots.serveOwed()) {
        return true;
      }
    }
  }

  /** Collects until no disposal's call is left to run, running each step of one with `step`. */
  collectFully(step: () => void): void {
    while (!this.collected()) {
      step();
    }
  }

  /**
   * Collects until no disposal is left to run, while the instance ends (§3.12): one that panics is
   * let go of, and the rest go on. A panic is the innermost running disposal's, its code's own or a
   * disposal of what that code let go of, which the collector lets go of at once: the running one
   * is abandoned once what it set off is done and it is innermost again, inside the loop. What
   * abandoning it releases is its own (`Collector.abandoned`): a panic disposing that abandons no
   * more.
   */
  collectEnding(step: () => void): void {
    let abandoning: ActiveFrame | LiveExecution | undefined;
    for (;;) {
      try {
        if (this.collected()) {
          return;
        }
        if (abandoning !== undefined && abandoning === this.disposals.innermost()) {
          abandoning = undefined;
          this.disposals.abandon();
        } else {
          step();
        }
      } catch (error) {
        if (panicOf(error) === undefined) {
          throw error;
        }
        const made = this.#collector.panicked();
        if (made !== 'released') {
          abandoning = this.disposals.innermost();
        }
        if (made === 'none' && abandoning === undefined) {
          throw error;
        }
      }
    }
  }
}
