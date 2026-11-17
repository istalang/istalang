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
 *   disposed first), and the run waits on the host only while one is pending. A host misusing one
 *   (filling it twice, an `onCancel` of its throwing) panics the run however it stands, even in the
 *   step that finishes it: the first misuse is thrown before any turn is taken.
 */

import { copied } from '../../definition/values/replacing.ts';
import { type HostFilling, Panic } from '../natives.ts';
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
  /** The first misuse of a host filling, which panics the run. */
  #misuse: Panic | undefined;

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
    this.#wakeWaiter();
  }

  /** Wakes what waits for the next arrival. */
  #wakeWaiter(): void {
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

  /** The turn that arrived first, taken out; a host's first misuse thrown before anything. */
  next(): Arrival | undefined {
    this.raiseMisuse();
    return this.#turns.shift();
  }

  get empty(): boolean {
    return this.#turns.length === 0;
  }

  /** Where the oldest turn waiting arrived among every run's; undefined with none waiting. */
  get first(): number | undefined {
    return this.#turns[0]?.order;
  }

  /** Settles once something arrives, at once if something has, a misuse included. */
  arrival(): Promise<void> {
    return this.#turns.length > 0 || this.#misuse !== undefined
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.#wake = resolve;
        });
  }

  /** Throws the first misuse of a host filling, if one came. */
  raiseMisuse(): void {
    if (this.#misuse !== undefined) {
      throw this.#misuse;
    }
  }

  /** Whether a host still owes the run something it waits on. */
  get awaitsHost(): boolean {
    return this.#hostWork > 0;
  }

  /**
   * How a host fills `future`, an extern's pending future of the run `owner` arriving there, the
   * extern called where `site` was made: each fill a turn settling it, in whichever run of the
   * instance it lands in, with a copy of its value.
   */
  filling(owner: Run, future: Future, site: Error): HostFilling {
    let state: 'pending' | 'resolved' | 'cancelled' = 'pending';
    const cancels: (() => void)[] = [];
    this.#hostWork += 1;
    const done = (run: Run) => {
      if (run === owner) {
        this.#hostWork -= 1;
      }
    };
    const traced = (panic: Panic) => new Panic(panic.message, { cause: site });
    const misused = (panic: Panic) => {
      this.#misuse ??= traced(panic);
      this.#wakeWaiter();
    };
    const cancelling = (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        misused(new Panic(`A host's onCancel threw: ${why}`, { cause: error }));
      }
    };
    future.cancels.push(() => {
      if (state === 'pending') {
        state = 'cancelled';
        this.#hostWork -= 1;
        for (const callback of cancels.splice(0)) {
          cancelling(callback);
        }
      }
    });
    const settle = (turn: (run: Run, filled: Future) => void) => {
      state = 'resolved';
      this.arrive(future, (run, filled) => {
        done(run);
        turn(run, filled);
      });
    };
    return {
      fill: (value) => {
        if (state !== 'pending') {
          return false;
        }
        settle((run, filled) => {
          const held = copied(value);
          run.lifetimes.hold(held);
          run.settle(filled, held);
        });
        return true;
      },
      fail: (panic) => {
        if (state === 'pending') {
          settle(() => {
            throw traced(panic);
          });
        }
      },
      misused,
      onCancel: (callback) => {
        if (state === 'cancelled') {
          cancelling(callback);
        } else {
          cancels.push(callback);
        }
      },
      state: () => state,
    };
  }
}
