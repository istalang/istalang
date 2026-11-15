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
 * - The counts tell which values may change in place (`values`, in-place.ts): a node held once.
 * - What the instance wrote values as is kept here (`written`,
 *   ../../definition/values/written-json.ts), since what it keeps is held in the counts and
 *   forgotten as a value changes in place.
 */

import type { Value } from '../../definition/values/values.ts';
import { WrittenJson } from '../../definition/values/written-json.ts';
import type { LiveObject } from '../scheduler/instance/heap.ts';
import { type Held, nothingHeld } from '../snapshot/holdings.ts';
import { Counts } from './counts.ts';
import { InPlace } from './in-place.ts';

export class HolderWrites {
  readonly #counted: (object: LiveObject) => boolean;
  readonly #counts = new Counts();
  /**
   * The JSON the instance wrote values as, each held for good
   * (../../definition/values/written-json.ts).
   */
  readonly written = new WrittenJson((json) => {
    this.changed(nothingHeld, { values: [json], holds: [] });
  });
  /** The instance's values changed in place where their counts allow (in-place.ts). */
  readonly values = new InPlace(this.#counts, this.written);
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
    this.written.forgetObject(id);
  }

  /** A holder that held `was` holds `now`. */
  changed(was: Held, now: Held): void {
    this.#counts.changed(was, now);
  }

  /**
   * Runs `move`, which hands `value` from one holder to another, holding it meanwhile: a value held
   * once then never passes through zero, letting go of its parts only to hold them again.
   */
  handOver<Result>(value: Value, move: () => Result): Result {
    const held: Held = { values: [value], holds: [] };
    this.changed(nothingHeld, held);
    try {
      return move();
    } finally {
      this.changed(held, nothingHeld);
    }
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
