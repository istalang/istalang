/**
 * Every write of a holder, reported in one place (docs/work/static-lifetimes/design.md §9.1): a
 * register (interpreter/registers.ts), a heap object's fields and the edges its indexes give it
 * (scheduler/instance/heap.ts), and a running call's own future (scheduler/segment/run-stack.ts).
 * Each reports what the holder held and what it holds now, so whatever decides lifetimes sees every
 * change, both what was let go of and what is held anew. The heap also says which objects it made
 * and which are gone.
 *
 * - Counting reads every report (counts.ts): a counted object whose count drops to zero has lost
 *   its last holder, which the collector confirms at the step's end (collector.ts).
 * - Tracing reads only what was let go of: an object a holder no longer holds may have lost its
 *   last holder, so it is noted for the collector, which checks it by reachability against the
 *   counts.
 * - A decided `select`'s losers are noted apart (`noteLosersReleased`): until the collector takes
 *   the noted objects, a loser may still wait in a slot's queue (scheduler/instance/slots.ts).
 * - A commit keeps only what is held, so it forgets what was noted (`settled`).
 */

import { pushAll } from '../../foundation/structures/stack.ts';
import type { LiveObject } from '../scheduler/instance/heap.ts';
import { type Held, idsHeld } from '../snapshot/holdings.ts';
import { Counts } from './counts.ts';

export class HolderWrites {
  readonly #counted: (object: LiveObject) => boolean;
  readonly #counts = new Counts();
  readonly #released: number[] = [];
  #losersReleased = false;

  /** Holder writes counting the objects `counted` says (counts.ts `countedIn`). */
  constructor(counted: (object: LiveObject) => boolean) {
    this.#counted = counted;
  }

  /** The heap made `object`, held by nothing yet. */
  made(object: LiveObject): void {
    if (this.#counted(object)) {
      this.#counts.made(object.id);
    }
  }

  /** Object `id` is gone from the heap. */
  gone(id: number): void {
    this.#counts.gone(id);
  }

  /** A holder that held `was` holds `now`. */
  changed(was: Held, now: Held): void {
    this.#counts.changed(was, now);
    const lost = idsHeld(was);
    if (lost.length === 0) {
      return;
    }
    const kept = new Set(idsHeld(now));
    pushAll(this.#released, kept.size === 0 ? lost : lost.filter((id) => !kept.has(id)));
  }

  /** How many holders counted object `id` has; undefined for one not counted. */
  holdersOf(id: number): number | undefined {
    return this.#counts.holdersOf(id);
  }

  /** Whether a counted object came to have no holder since the zeroes were last taken. */
  get zeroed(): boolean {
    return this.#counts.zeroed;
  }

  /** The counted objects with no holder now, of those that came to have none since last time. */
  takeZeroes(): readonly number[] {
    return this.#counts.takeZeroes();
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
