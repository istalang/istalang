/**
 * What arrives in a run from outside it (§9): a host filling its extern's future, another
 * instance's answer or end, a mock's answer (world.ts, mock-answers.ts). Each arrives as a turn of
 * its own, run between the run's steps, never inside one; whatever waits for the next arrival wakes
 * as one comes.
 *
 * - **On its object.** A turn concerns one object of the run it lands in. A run replaced by one read
 *   back from its snapshot (a segment run again, §5) hands on what arrived and all that arrives
 *   after, which acts there on the object of the same id.
 * - **In order.** Every run's arrivals are numbered as they come, so a world runs its runs in the
 *   order their turns arrived.
 * - **Host fillings.** A host filling is pending until filled, failed or cancelled (its future
 *   disposed first), and the run waits on the host only while one is pending.
 */

import { copied } from '../../definition/values/replacing.ts';
import type { HostFilling } from '../natives.ts';
import type { Future } from './objects/future.ts';
import type { RunObject } from './objects/run-object.ts';
import type { Run } from './run.ts';

/** A turn arriving from outside a run: what it does, on which object, and where it came in order. */
export interface Arrival {
  /** The object, in the run it arrived at; undefined once it moved on, its id naming it there. */
  readonly object: RunObject | undefined;
  readonly id: number;
  readonly turn: (run: Run, object: RunObject) => void;
  readonly order: number;
}

export class Arrivals {
  /** How many turns arrived at any run, which orders arrivals across runs. */
  static #arrived = 0;
  readonly #turns: Arrival[] = [];
  #wake: (() => void) | undefined;
  /** How many host fillings are still pending. */
  #hostWork = 0;
  /** The arrivals of the run its instance goes on in, once a segment run again replaced this one. */
  #successor: Arrivals | undefined;
  /** The objects a snapshot read back made, by id, which a turn handed on acts on. */
  #restored: ReadonlyMap<number, RunObject> = new Map();

  /** Readies `turn` on `object`, and wakes what waits for an arrival. */
  arrive<Target extends RunObject>(object: Target, turn: (run: Run, object: Target) => void): void {
    this.#queue({
      object,
      id: object.object,
      turn: turn as Arrival['turn'],
      order: Arrivals.#arrived,
    });
    Arrivals.#arrived += 1;
  }

  #queue(arrival: Arrival): void {
    if (this.#successor !== undefined) {
      this.#successor.#queue({ ...arrival, object: undefined });
      return;
    }
    this.#turns.push(arrival);
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  /** Hands on to `next` what arrived and hasn't run, and all that arrives from now on. */
  succeededBy(next: Arrivals): void {
    this.#successor = next;
    for (const arrival of this.#turns.splice(0)) {
      next.#queue({ ...arrival, object: undefined });
    }
  }

  /** Knows the objects a snapshot read back made, by id (snapshot/restore.ts). */
  restoredObjects(objects: ReadonlyMap<number, RunObject>): void {
    this.#restored = objects;
  }

  /**
   * The object `arrival` acts on: its own, or the one of its id a snapshot read back made; none
   * for an object the run made again, whose maker gives it its own.
   */
  objectOf(arrival: Arrival): RunObject | undefined {
    return arrival.object ?? this.#restored.get(arrival.id);
  }

  /** The turn that arrived first, taken out. */
  next(): Arrival | undefined {
    return this.#turns.shift();
  }

  get empty(): boolean {
    return this.#turns.length === 0;
  }

  /** Where the oldest turn waiting arrived among every run's; undefined with none waiting. */
  get first(): number | undefined {
    return this.#turns[0]?.order;
  }

  /** Settles once something arrives, at once if something has. */
  arrival(): Promise<void> {
    return this.#turns.length > 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.#wake = resolve;
        });
  }

  /** Whether a host still owes the run something it waits on. */
  get awaitsHost(): boolean {
    return this.#hostWork > 0;
  }

  /**
   * How a host fills `future`, an extern's pending future of the run `owner` arriving there: each
   * fill a turn settling it, in whichever run of the instance it lands in, with a copy of its value.
   */
  filling(owner: Run, future: Future): HostFilling {
    let state: 'pending' | 'resolved' | 'cancelled' = 'pending';
    this.#hostWork += 1;
    const done = (run: Run) => {
      if (run === owner) {
        this.#hostWork -= 1;
      }
    };
    future.cancels.push(() => {
      if (state === 'pending') {
        state = 'cancelled';
        this.#hostWork -= 1;
      }
    });
    return {
      fill: (value) => {
        if (state !== 'pending') {
          return false;
        }
        state = 'resolved';
        this.arrive(future, (run, filled) => {
          done(run);
          const held = copied(value);
          run.lifetimes.hold(held);
          run.settle(filled, held);
        });
        return true;
      },
      fail: (panic) => {
        state = 'resolved';
        this.arrive(future, (run) => {
          done(run);
          throw panic;
        });
      },
      onCancel: (callback) => {
        future.cancels.push(callback);
      },
      state: () => state,
    };
  }
}
