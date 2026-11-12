/**
 * Disposing what lost its last holder (spec §7), at the release point that lost it.
 *
 * No cycle passes through an object that reaches a disposable (spec §7, "Cycles"), so counting its
 * holders (counts.ts) tells when it lost the last one. After every step, the scheduler collects:
 * the counted objects whose count dropped to zero during the step, and is still zero at its end,
 * lost their last holder. Several paths let go of something before they hold it again within a
 * step, so a zero is only confirmed there.
 *
 * - **What does nothing when disposed is gone at once,** such as a resolved future, a cell of a
 *   type with no `dispose` or a timer nothing is registered on: it leaves the heap and its indexes
 *   (a pending timer nothing holds no longer wakes a live run), which lets go of what it held, so
 *   a disposable it was the last holder of reaches zero in the same round.
 * - **The disposables that reached zero are one round,** disposed newest first. One that still
 *   holds another keeps it from zero, so a holder is disposed before what it holds, seeing it
 *   intact (a `dispose` reads `*self`). Disposing one lets go of what it held, which the round
 *   after disposes, until none is left.
 *
 * A disposal that runs code (a declared `dispose`, a disposed call's cleanup) runs on the
 * scheduler's run stack, as every call does (scheduler/segment/), and the round waits for it to
 * finish. Once a disposed object is gone, its weak reference lets go of it and its `disposed()`
 * watches resolve (scheduler/instance/weak-side.ts). Code a callback runs may let go of something
 * in turn; that starts a round of its own, on top, finished before the callback goes on. Whatever
 * a waiting round has yet to dispose is that round's, so no later round takes it out of order.
 *
 * A disposal may ready calls as runs, roots of their own: a pending resolver's `onCancel`
 * callbacks. The run holds what it calls with before the resolver lets
 * go of it, so nothing it calls with reaches zero.
 */

import { unreachable } from '../../foundation/structures/unreachable.ts';
import { type DisposalContext, type DisposalRun, dispose, isDisposable } from './disposal.ts';
import type { HolderWrites } from './holder-writes.ts';

export interface CollectorSeams extends DisposalContext {
  /** Where every holder write is reported and counted. */
  readonly holders: HolderWrites;
  /** Starts `run`: true when it has finished already (a native), false while it runs as code. */
  readonly run: (run: DisposalRun) => boolean;
}

/** One round: what it has yet to dispose, newest first, and the object whose call it waits on. */
interface Round {
  readonly queue: number[];
  disposing: number | undefined;
}

export class Collector {
  readonly #seams: CollectorSeams;
  readonly #rounds: Round[] = [];
  /** The object being disposed before any code of its disposal runs: one that panics leaves it. */
  #making: number | undefined;

  constructor(seams: CollectorSeams) {
    this.#seams = seams;
  }

  /** Whether a round waits on a disposal's call; the scheduler runs it before going on. */
  get busy(): boolean {
    return this.#rounds.length > 0;
  }

  /**
   * Disposes what lost its last holder by the end of a step, as far as it can before a disposal's
   * call must run.
   */
  collect(): void {
    this.#startRound();
    this.#proceed();
  }

  /** The code the newest round waited on finished: its object is gone, and the round goes on. */
  returned(): void {
    const round = this.#rounds.at(-1);
    if (round?.disposing === undefined) {
      unreachable('A disposal call returned with no round waiting on it.');
    }
    this.#gone(round.disposing);
    round.disposing = undefined;
    this.#proceed();
  }

  /**
   * The disposal it was making panicked before any code of it ran, while its instance ends: its
   * object is gone, and its round stalls until the next `collect` takes it on. Whether it was
   * making one.
   */
  panicked(): boolean {
    const id = this.#making;
    if (id === undefined) {
      return false;
    }
    this.#making = undefined;
    const round = this.#rounds.at(-1);
    if (round?.disposing === id) {
      round.disposing = undefined;
    }
    this.#gone(id);
    return true;
  }

  #proceed(): void {
    for (let round = this.#rounds.at(-1); round !== undefined; round = this.#rounds.at(-1)) {
      if (round.disposing !== undefined) {
        return;
      }
      const id = round.queue.shift();
      if (id === undefined) {
        this.#rounds.pop();
        this.#startRound();
      } else {
        this.#dispose(round, id);
      }
    }
  }

  #dispose(round: Round, id: number): void {
    const { heap } = this.#seams;
    if (!heap.has(id)) {
      return;
    }
    this.#making = id;
    const run = dispose(this.#seams, heap.objectOf(id));
    if (run === undefined) {
      this.#making = undefined;
      this.#gone(id);
      return;
    }
    round.disposing = id;
    const done = this.#seams.run(run);
    this.#making = undefined;
    if (done) {
      this.#gone(id);
      round.disposing = undefined;
    }
  }

  /** The disposed object `id` is gone. */
  #gone(id: number): void {
    this.#seams.heap.remove(id);
    this.#seams.weak.disposed(id);
  }

  /** Starts a round of the disposables that lost their last holder, if any did. */
  #startRound(): void {
    const ready = this.#zeroDisposables();
    if (ready.length > 0) {
      this.#rounds.push({ queue: [...ready], disposing: undefined });
    }
  }

  /**
   * The disposables whose count dropped to zero, newest first, but those a waiting round has yet
   * to dispose: any other object whose count did is gone at once, which lets go of what it held,
   * as its disposal does nothing.
   */
  #zeroDisposables(): readonly number[] {
    const { heap, holders } = this.#seams;
    let zeroes = holders.takeZeroes();
    if (zeroes.length === 0) {
      return [];
    }
    const waiting = new Set(
      this.#rounds.flatMap(({ queue, disposing }) =>
        disposing === undefined ? queue : [...queue, disposing],
      ),
    );
    const disposables: number[] = [];
    for (; zeroes.length > 0; zeroes = holders.takeZeroes()) {
      for (const id of zeroes.filter((zero) => !waiting.has(zero))) {
        if (isDisposable(this.#seams, heap.objectOf(id))) {
          disposables.push(id);
        } else {
          heap.remove(id);
        }
      }
    }
    return disposables.sort((first, second) => second - first);
  }
}
