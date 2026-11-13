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
 *   a disposable it was the last holder of reaches zero with it.
 * - **The disposables that reached zero are one round,** disposed newest first. One that still
 *   holds another keeps it from zero, so a holder is disposed before what it holds, seeing it
 *   intact (a `dispose` reads `*self`). What a round's disposals let go of is the round after it
 *   (`next`), started once its own queue is done, so a disposal never runs ahead of the rest of
 *   its round.
 *
 * A disposal that runs code (a declared `dispose`, a disposed call's cleanup) runs on the
 * scheduler's run stack, as every call does (scheduler/segment/), and the round waits for it to
 * finish. What that code lets go of is disposed at the end of its step, a round of its own on top,
 * finished before the code goes on; its own variables, released as it returns, are disposed before
 * the object it disposed is gone. Once any object is gone, disposed or gone at once, its weak
 * reference lets go of it and its `disposed()` watches resolve (scheduler/instance/weak-side.ts): a
 * weak reference only observes, so it never makes a holder disposable, which would put what it
 * holds a round later. Whatever a round has yet to dispose is that round's, so no other round takes
 * it out of order.
 *
 * While an instance ends, a disposal whose code panics is abandoned (scheduler/segment/): it ends
 * as a return does, and what it lets go of, its frames and its object's fields, is released by it,
 * as is what a disposal of any of that lets go of in turn (`#released`): a disposal of any of it
 * that panics abandons no other, where any other panic is the innermost running disposal's.
 *
 * A disposal may ready calls as runs, roots of their own: a pending resolver's `onCancel`
 * callbacks. The run holds what it calls with before the resolver lets go of it, so nothing it
 * calls with reaches zero.
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

/**
 * One round: what it has yet to dispose, newest first; the object whose disposal's code it waits
 * on, and whether that code returned; and what its disposals let go of that lost its last holder,
 * the round after it.
 */
interface Round {
  readonly queue: number[];
  disposing: number | undefined;
  returned: boolean;
  readonly next: number[];
}

export class Collector {
  readonly #seams: CollectorSeams;
  readonly #rounds: Round[] = [];
  /** The object being disposed before any code of its disposal runs: one that panics leaves it. */
  #making: number | undefined;
  /**
   * The disposables an abandoned disposal let go of, through its frames or its object, or through
   * the disposal of one of them: a disposal of one that panics is that abandoned disposal's, which
   * abandons no more.
   */
  readonly #released = new Set<number>();

  constructor(seams: CollectorSeams) {
    this.#seams = seams;
  }

  /** Whether a round waits on a disposal's call; the scheduler runs it before going on. */
  get busy(): boolean {
    return this.#rounds.length > 0;
  }

  /**
   * Disposes what lost its last holder by the end of a step, as far as it can before a disposal's
   * call must run: a round of its own, on top of any round waiting on that step's code.
   */
  collect(): void {
    // What the step let go of is released if the disposal whose code ran it was released, or
    // abandoned, which leaves its round waiting on it until the next `#proceed`.
    const running = this.#rounds.at(-1)?.disposing;
    this.#push(this.#zeroDisposables(running !== undefined && this.#released.has(running)));
    this.#proceed();
  }

  /**
   * The code the newest round waited on returned. Its object goes once what that code let go of
   * is disposed, at the step's end (`collect`).
   */
  returned(): void {
    const round = this.#rounds.at(-1);
    if (round?.disposing === undefined) {
      unreachable('A disposal call returned with no round waiting on it.');
    }
    round.returned = true;
  }

  /**
   * The code the newest round waited on was abandoned, as it panicked while its instance ends: it
   * ends as a return does, and what it let go of, its frames now and its object's fields once it is
   * gone, is released by it (`#released`).
   */
  abandoned(): void {
    this.returned();
    const id = this.#rounds.at(-1)?.disposing;
    if (id !== undefined) {
      this.#released.add(id);
    }
  }

  /**
   * The disposal it was making panicked before any code of it ran, while its instance ends: its
   * object is gone, and its round goes on at the next `collect`. Which it was making:
   * none; one of what abandoning a disposal released, which abandons no more; or one of what the
   * running code let go of.
   */
  panicked(): 'none' | 'released' | 'letGo' {
    const id = this.#making;
    const round = this.#rounds.at(-1);
    if (id === undefined || round === undefined) {
      return 'none';
    }
    this.#making = undefined;
    if (round.disposing === id) {
      round.disposing = undefined;
    }
    const released = this.#released.has(id);
    this.#gone(round, id);
    return released ? 'released' : 'letGo';
  }

  #proceed(): void {
    for (let round = this.#rounds.at(-1); round !== undefined; round = this.#rounds.at(-1)) {
      if (round.disposing === undefined) {
        const id = round.queue.shift();
        if (id === undefined) {
          this.#rounds.pop();
          this.#push(round.next);
        } else {
          this.#dispose(round, id);
        }
      } else {
        if (!round.returned) {
          return;
        }
        const id = round.disposing;
        round.disposing = undefined;
        round.returned = false;
        this.#gone(round, id);
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
      this.#gone(round, id);
      return;
    }
    round.disposing = id;
    const done = this.#seams.run(run);
    this.#making = undefined;
    if (done) {
      round.disposing = undefined;
      this.#gone(round, id);
    }
  }

  /**
   * The disposed object `id` is gone: what lost its last holder with it is `round`'s next, released
   * by an abandoned disposal if `id` was.
   */
  #gone(round: Round, id: number): void {
    const released = this.#released.has(id);
    this.#remove(id);
    round.next.push(...this.#zeroDisposables(released));
  }

  /**
   * Takes object `id` out of the heap, which lets go of what it held, and tells its weak reference,
   * whose watches resolve, whether it was disposed or did nothing when it lost its last holder.
   */
  #remove(id: number): void {
    this.#seams.heap.remove(id);
    this.#seams.weak.disposed(id);
    this.#released.delete(id);
  }

  /** Starts a round of `ready`, if any. */
  #push(ready: readonly number[]): void {
    if (ready.length > 0) {
      const queue = [...ready].sort((first, second) => second - first);
      this.#rounds.push({ queue, disposing: undefined, returned: false, next: [] });
    }
  }

  /**
   * The disposables whose count dropped to zero since the zeroes were last taken, but those a
   * round has yet to dispose: any other object whose count did is gone at once, which lets go of
   * what it held, as its disposal does nothing. Each is `released` by an abandoned disposal or not.
   */
  #zeroDisposables(released: boolean): readonly number[] {
    const { heap, holders } = this.#seams;
    let zeroes = holders.takeZeroes();
    if (zeroes.length === 0) {
      return [];
    }
    const waiting = new Set(
      this.#rounds.flatMap(({ queue, disposing, next }) =>
        disposing === undefined ? [...queue, ...next] : [...queue, ...next, disposing],
      ),
    );
    const disposables: number[] = [];
    for (; zeroes.length > 0; zeroes = holders.takeZeroes()) {
      for (const id of zeroes.filter((zero) => !waiting.has(zero))) {
        if (isDisposable(this.#seams, heap.objectOf(id))) {
          disposables.push(id);
          if (released) {
            this.#released.add(id);
          }
        } else {
          this.#remove(id);
        }
      }
    }
    return disposables;
  }
}
