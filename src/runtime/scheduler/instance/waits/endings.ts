/**
 * How a language resolver stops being pending without deciding anything (proposal 8, Rule 5;
 * index.ts): cancelled, its `onCancel` callbacks readied, what it awaited given up on once its case
 * lost (spec §8), and the `Resolver.at` ones deciding it ending as it did; and how a decided wait's
 * losing cases so end, but one on its waiter's own `disposing()` watch (§7).
 */

import type { Value } from '../../../../definition/values/values.ts';
import type { Heap, LiveExecution } from '../heap.ts';
import {
  type Ended,
  isPending,
  type PendingResolver,
  pendingCases,
  pendingOf,
  type Resolver,
  type Wait,
  waiterOf,
} from './resolvers.ts';

/**
 * Why a pending resolver stops being awaited: its case lost to another (spec §8), which gives up on
 * what it awaited, or withdrawn undecided, which leaves that as it was.
 */
export type Ending = 'lost' | 'withdrawn';

/** What ending resolvers reaches outside the waits. */
export interface EndingSeams {
  /** Whether `future` is a pending `disposing()` watch on the call `waiter` runs (§7). */
  readonly watchesCall: (waiter: LiveExecution, future: number) => boolean;
  /** Readies a call of the function value `callback` with `argumentValues`, a driver of its own. */
  readonly called: (callback: Value, argumentValues: readonly Value[]) => void;
  /** A case awaiting `future` lost to another (spec §8): it is given up on (slots.ts). */
  readonly givenUp: (future: number) => void;
  /** A decided wait's losing cases let go of what they awaited (spec §8). */
  readonly losersReleased: () => void;
}

export class ResolverEndings {
  readonly #heap: Heap;
  readonly #seams: EndingSeams;

  constructor(heap: Heap, seams: EndingSeams) {
    this.#heap = heap;
    this.#seams = seams;
  }

  /**
   * Cancels the resolvers still pending of `wait`, decided, but one on its waiter's own watch,
   * which stays registered there alone. Each lets go of what else it awaited, a losing case's
   * (spec §8), which may wait in a slot's queue.
   */
  cancelLosers(wait: Wait): void {
    for (const other of pendingCases(this.#heap, wait)) {
      const kept = other.state.on.filter((future) => this.keeps(wait, future));
      if (kept.length === 0) {
        this.cancel(other, 'lost');
        this.#seams.losersReleased();
      } else if (kept.length < other.state.on.length) {
        this.#heap.replace({ ...other, state: { ...other.state, on: kept } });
        for (const future of other.state.on.filter((each) => !kept.includes(each))) {
          this.#seams.givenUp(future);
        }
        this.#seams.losersReleased();
      }
    }
  }

  /** Whether a resolver of `wait`, decided, stays registered on `future`: its own call's watch. */
  keeps(wait: Wait, future: number): boolean {
    const waiter = waiterOf(this.#heap, wait);
    return waiter !== undefined && this.#seams.watchesCall(waiter, future);
  }

  /** Cancels `resolver`, if it is still pending, ending as `ending` says. */
  cancel(resolver: Resolver, ending: Ending): void {
    if (isPending(resolver)) {
      this.end(resolver, { kind: 'cancelled' }, ending);
    }
  }

  /**
   * Ends the pending `resolver` as `state` says without deciding anything: its `onCancel` run, what
   * it awaited given up on once it lost, and its pending `Resolver.at` ones ending as it did.
   */
  end(resolver: PendingResolver, state: Ended, ending: Ending): void {
    this.replace(resolver, state);
    for (const callback of resolver.state.onCancel) {
      this.#seams.called(callback, []);
    }
    if (ending === 'lost') {
      for (const future of resolver.state.on) {
        this.#seams.givenUp(future);
      }
    }
    this.cancelPositions(resolver, ending);
  }

  /**
   * Ends the pending `resolver` as `state` says, its case lost, and so the resolver a `Resolver.at`
   * one decides in turn, whose case it lost too.
   */
  lose(resolver: PendingResolver, state: Ended): void {
    this.end(resolver, state, 'lost');
    const { target } = resolver.state;
    if (target.kind === 'at') {
      this.lose(pendingOf(this.#heap, target.done), state);
    }
  }

  /**
   * Cancels the pending `Resolver.at` resolvers deciding `resolver`, which no longer is pending:
   * lost once it was decided or lost, withdrawn with it.
   */
  cancelPositions(resolver: Resolver, ending: Ending): void {
    for (const position of this.#heap.find('positions', resolver.id)) {
      this.cancel(position, ending);
    }
  }

  /** Replaces `resolver`'s state, which lets go of what awaited it through the heap's indexes. */
  replace(resolver: Resolver, state: Resolver['state']): void {
    this.#heap.replace({ ...resolver, state });
  }
}
