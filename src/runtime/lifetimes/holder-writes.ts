/**
 * Every write of a holder, reported in one place (docs/work/static-lifetimes/design.md §9.1): a
 * register (interpreter/registers.ts), a heap object's fields and the edges its indexes give it
 * (scheduler/instance/heap.ts), and a running call's own future (scheduler/segment/run-stack.ts).
 * Each reports what the holder held and what it holds now, so whatever decides lifetimes sees every
 * change, both what was let go of and what is held anew.
 *
 * - Tracing reads only what was let go of: an object a holder no longer holds may have lost its
 *   last holder, so it is noted for the collector (collector.ts), which decides by reachability.
 *   What the holder still holds is left out, as it is held.
 * - A decided `select`'s losers are noted apart (`noteLosersReleased`): until the collector takes
 *   the noted objects, a loser may still wait in a slot's queue (scheduler/instance/slots.ts).
 * - A commit keeps only what is held, so it forgets what was noted (`settled`).
 */

import { pushAll } from '../../foundation/structures/stack.ts';
import { type Held, idsHeld } from '../snapshot/holdings.ts';

export class HolderWrites {
  readonly #released: number[] = [];
  #losersReleased = false;

  /** A holder that held `was` holds `now`. */
  changed(was: Held, now: Held): void {
    const lost = idsHeld(was);
    if (lost.length === 0) {
      return;
    }
    const kept = new Set(idsHeld(now));
    pushAll(this.#released, kept.size === 0 ? lost : lost.filter((id) => !kept.has(id)));
  }

  /** Notes `ids` again for collecting, as the collector puts back what a round skipped. */
  noteReleased(ids: Iterable<number>): void {
    pushAll(this.#released, ids);
  }

  /** The objects that may have lost their last holder since the last call, for collecting. */
  takeReleased(): readonly number[] {
    this.#losersReleased = false;
    return this.#released.splice(0);
  }

  /** Notes that a decided `select` let go of what its losing cases held (spec §8). */
  noteLosersReleased(): void {
    this.#losersReleased = true;
  }

  /**
   * Whether a decided `select` let go of what its losing cases held since the released were last
   * taken for collecting: until then, one of them may still wait in a queue.
   */
  get losersUncollected(): boolean {
    return this.#losersReleased;
  }

  /** Forgets what was noted, as a commit keeps only what is held (`Heap.keepOnly`). */
  settled(): void {
    this.#released.length = 0;
    this.#losersReleased = false;
  }
}
