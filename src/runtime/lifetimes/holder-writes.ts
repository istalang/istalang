/**
 * Every write of a holder, reported in one place (docs/work/static-lifetimes/design.md §9.1): a
 * register (interpreter/registers.ts), a heap object's fields and the edges its indexes give it
 * (scheduler/instance/heap.ts), and a running call's own future (scheduler/segment/run-stack.ts).
 * Each reports what the holder held and what it holds now, and the heap which objects it made and
 * which are gone, so counting sees every change (counts.ts): a counted object whose count drops to
 * zero lost its last holder, which the collector confirms at the step's end (collector.ts).
 *
 * - The counted objects let go of are logged for a test's check of the heap, which walks from
 *   them (scheduler/loaded-definition.ts `HeapCheck`): a cycle can close as a call suspends, which
 *   writes into nothing.
 * - A decided `select`'s losers are noted apart (`noteLosersReleased`): until the collector takes
 *   the step's zeroes, a loser may still wait in a slot's queue (scheduler/instance/slots.ts).
 * - A commit keeps only what is held, so it forgets what was noted (`settled`).
 */

import type { LiveObject } from '../scheduler/instance/heap.ts';
import type { Held } from '../snapshot/holdings.ts';
import { Counts } from './counts.ts';

export class HolderWrites {
  readonly #counted: (object: LiveObject) => boolean;
  readonly #counts = new Counts();
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
  }

  /** How many holders counted object `id` has; undefined for one not counted. */
  holdersOf(id: number): number | undefined {
    return this.#counts.holdersOf(id);
  }

  /**
   * The counted objects with no holder now, of those that came to have none since last time: the
   * step's end, which collects the losers a decided `select` let go of too.
   */
  takeZeroes(): readonly number[] {
    this.#losersReleased = false;
    return this.#counts.takeZeroes();
  }

  /** The counted objects with no holder now that the zeroes last taken left out: none at a commit. */
  unconfirmed(): readonly number[] {
    return this.#counts.zeroes();
  }

  /** The counted objects let go of since the last call, for a test's check of the heap. */
  takeLetGo(): readonly number[] {
    return this.#counts.takeLetGo();
  }

  /** Notes that a decided `select` let go of what its losing cases held (spec §8). */
  noteLosersReleased(): void {
    this.#losersReleased = true;
  }

  /**
   * Whether a decided `select` let go of what its losing cases held since the step's zeroes were
   * last taken: until then, one of them may still wait in a queue.
   */
  get losersUncollected(): boolean {
    return this.#losersReleased;
  }

  /** Forgets what was noted, as a commit keeps only what is held (`Heap.keepOnly`). */
  settled(): void {
    this.#losersReleased = false;
    this.#counts.takeLetGo();
  }
}
