/**
 * Disposing what lost its last holder (spec §7), at the release point that lost it.
 *
 * After an instruction that let go of something (the heap's notes), the scheduler collects: a
 * walk from the roots (holders.ts) finds what nothing holds, and the disposables ready among it
 * (orphans.ts) are disposed newest first, as one round. Disposing them lets go of what they held,
 * which the round after disposes, until nothing unheld is ready. Objects that aren't disposable
 * are simply left out of the next commit. Most of what code lets go of holds nothing disposable,
 * such as a cell of plain values, or is still held elsewhere, such as a copy of what a variable
 * holds. Collecting therefore first finds the disposables what was let go of reaches, and asks
 * whether they are all still held, a walk that stops once it has found them (holders.ts); only
 * when one isn't does a round start.
 *
 * A disposal that runs code (a `defer` callback, a declared `dispose`, a disposed call's cleanup)
 * runs on the scheduler's run stack, as every call does (scheduler/segment/), and the round waits
 * for it to finish. Once a disposed object is gone, its weak reference lets go of it and its
 * `disposed()` watches resolve (scheduler/instance/weak-side.ts).
 * Code a callback runs may let go of something in turn; that starts a round of its own, on top,
 * finished before the callback goes on. Whatever a waiting round has yet to dispose counts as held,
 * so no later round takes it out of order.
 */

import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { LiveObject } from '../scheduler/instance/heap.ts';
import { type DisposalContext, type DisposalRun, dispose, isDisposable } from './disposal.ts';
import { heldUnlessAll, type Roots, walkHolds } from './holders.ts';
import { readyOrphans } from './orphans.ts';

export interface CollectorSeams extends DisposalContext {
  /** What holds things besides waiting rounds: frames, and objects the scheduler names. */
  readonly roots: () => Roots;
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

  constructor(seams: CollectorSeams) {
    this.#seams = seams;
  }

  /** Whether a round waits on a disposal's call; the scheduler runs it before going on. */
  get busy(): boolean {
    return this.#rounds.length > 0;
  }

  /**
   * Disposes what is ready now, as far as it can before a disposal's call must run, after the
   * objects `released` lost a holder.
   */
  collect(released: readonly number[]): void {
    this.#startRound(released);
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

  #proceed(): void {
    for (let round = this.#rounds.at(-1); round !== undefined; round = this.#rounds.at(-1)) {
      if (round.disposing !== undefined) {
        return;
      }
      const id = round.queue.shift();
      if (id === undefined) {
        this.#rounds.pop();
        this.#startRound(this.#seams.heap.takeReleased());
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
    const run = dispose(this.#seams, heap.objectOf(id));
    if (run === undefined) {
      this.#gone(id);
      return;
    }
    round.disposing = id;
    if (this.#seams.run(run)) {
      this.#gone(id);
      round.disposing = undefined;
    }
  }

  /** The disposed object `id` is gone. */
  #gone(id: number): void {
    this.#seams.heap.remove(id);
    this.#seams.weak.disposed(id);
  }

  /** Starts a round of what is ready, if anything is, after the objects `released` lost a holder. */
  #startRound(released: readonly number[]): void {
    const { heap } = this.#seams;
    const reached = disposablesFrom(this.#seams, released);
    const held = reached.size === 0 ? undefined : heldUnlessAll(heap, this.#roots(), reached);
    if (held === undefined) {
      return;
    }
    const isDisposableObject = (object: LiveObject) => isDisposable(this.#seams, object);
    const ready = readyOrphans(heap, { held, from: released, isDisposable: isDisposableObject });
    if (ready.length > 0) {
      this.#rounds.push({ queue: [...ready], disposing: undefined });
    }
  }

  /** The scheduler's roots, and what waiting rounds have yet to dispose, which counts as held. */
  #roots(): Roots {
    const roots = this.#seams.roots();
    const waiting = this.#rounds.flatMap(({ queue, disposing }) =>
      disposing === undefined ? queue : [...queue, disposing],
    );
    return { frames: roots.frames, objects: [...roots.objects, ...waiting] };
  }
}

/** The disposables among `released` and what they hold: the only ones that can be lost. */
function disposablesFrom(seams: CollectorSeams, released: readonly number[]): ReadonlySet<number> {
  const disposables = new Set<number>();
  walkHolds(seams.heap, released, (object) => {
    if (isDisposable(seams, object)) {
      disposables.add(object.id);
    }
    return 'through';
  });
  return disposables;
}
