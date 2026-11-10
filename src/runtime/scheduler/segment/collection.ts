/**
 * A segment's collecting (runtime/lifetimes/): after every instruction that let go of something,
 * what lost its last holder is disposed right there (§7), and a drive ends only once collecting
 * has. A disposal that runs code runs on the segment's run stack as any call does
 * (disposal-runs.ts), each of its steps the segment's own, so collecting is handed the step to
 * take. What holds things is every execution's frames, the running ones first, and what the run
 * stack and the test world hold.
 */

import { Collector } from '../../lifetimes/collector.ts';
import type { Roots } from '../../lifetimes/holders.ts';
import { type DisposalRunSeams, DisposalRuns } from './disposal-runs.ts';
import { panicOf } from './limits.ts';

/** What a segment's collecting reads: its instance, its run stack, the caller of its calls. */
type CollectionSeams = Omit<DisposalRunSeams, 'returned'>;

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
    });
    this.#collector = new Collector({
      heap: instance.heap,
      types: instance.loaded.definition.types,
      roots: () => this.#roots(),
      stop: (execution) => {
        instance.stop(execution);
      },
      weak: instance.weak,
      run: (run) => this.disposals.start(run),
    });
  }

  /** Collects what lost a holder since the last step; whether no disposal's call is left to run. */
  collected(): boolean {
    const released = this.#seams.instance.heap.takeReleased();
    if (released.length > 0) {
      this.#collector.collect(released);
    }
    return !this.#collector.busy;
  }

  /** Collects until no disposal's call is left to run, running each step of one with `step`. */
  collectFully(step: () => void): void {
    while (!this.collected()) {
      step();
    }
  }

  /**
   * Collects until no disposal is left to run, while the instance ends: one that panics, as `step`
   * runs it, is let go.
   */
  collectEnding(step: () => void): void {
    this.collectFully(() => {
      try {
        step();
      } catch (error) {
        if (panicOf(error) === undefined) {
          throw error;
        }
        this.disposals.abandon();
      }
    });
  }

  /**
   * What holds things besides the collector's own rounds (lifetimes/holders.ts): every execution's
   * frames, the carrier's, the call futures of the executions running on the run stack, and the
   * answers still to give (§10). The frames running now come first, innermost first, as what code
   * lets go of is mostly held there.
   */
  #roots(): Roots {
    const { instance, runStack } = this.#seams;
    const running = runStack.innermostFirst();
    const waiting = instance.heap
      .objectsOf('execution')
      .filter((execution) => !running.includes(execution));
    return {
      frames: [...running, ...waiting].flatMap((execution) => execution.frames.toReversed()),
      objects: [...runStack.callFutures(), ...instance.answers()],
    };
  }
}
