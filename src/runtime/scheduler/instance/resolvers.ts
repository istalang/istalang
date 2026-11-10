/**
 * A running instance's resolvers (proposal 8, Rule 5): one per wait, the one way a waiting
 * execution resumes.
 *
 * - An execution that stops at an `await` or a blocking `select` gets a resolver, registered on the
 *   futures its wait names, in its cases' order. Resolving a future decides the resolvers
 *   registered on it, found by lookup, so resolving costs what waits on that future, never a walk
 *   of every execution.
 * - A resolver decides once, at the first of its futures to resolve: the lowest case among those
 *   that resolved together, or were resolved already when the wait began. Deciding drops its
 *   registrations and tells the instance, which readies the waiter and lets go of the cases it
 *   lost (spec §8), so a losing `take` leaves its slot's queue before a later value can reach it.
 * - Waiters that become ready together are readied in creation order, once each (§6).
 * - A resolver is a heap object, so an instance's are committed with the frames they resume, and a
 *   crash discards a decision with the segment that made it; a live run's stay in memory.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Decision } from '../../interpreter/suspension.ts';
import type { Settled } from './futures.ts';
import type { Heap, LiveExecution, LiveObjectOf } from './heap.ts';

/** What deciding a resolver tells the instance: `waiter` is to resume as `decision` says. */
type Decided = (waiter: LiveExecution, decision: Decision) => void;

type Resolver = LiveObjectOf<'resolver'>;

type PendingResolver = Resolver & { readonly state: { readonly kind: 'pending' } };

export class Resolvers {
  readonly #heap: Heap;
  readonly #decided: Decided;

  /** Resolvers on `heap`, telling `decided` each decision. */
  constructor(heap: Heap, decided: Decided) {
    this.#heap = heap;
    this.#decided = decided;
  }

  /**
   * Gives `waiter` a resolver registered on `futures`, its wait's, in its cases' order, decided at
   * once at the first of them `settled` says has resolved.
   */
  wait(
    waiter: LiveExecution,
    futures: readonly number[],
    settled: (future: number) => Settled | undefined,
  ): void {
    const resolver = this.#heap.add(
      (id): Resolver => ({
        kind: 'resolver',
        id,
        waiter: waiter.id,
        state: { kind: 'pending', futures: [...futures] },
      }),
    );
    for (const [position, future] of futures.entries()) {
      const resolved = settled(future);
      if (resolved !== undefined) {
        this.#decide(resolver, { position, value: resolved.value });
        return;
      }
    }
  }

  /**
   * Decides every resolver registered on one of `resolved`, futures that resolved together, at the
   * first of its own futures among them, with what `settled` says that one resolved with.
   */
  settle(resolved: ReadonlySet<number>, settled: (future: number) => Settled): void {
    const deciding = new Set<PendingResolver>();
    for (const future of resolved) {
      for (const resolver of this.#heap.find('resolvers', future).filter(isPending)) {
        deciding.add(resolver);
      }
    }
    const byWaiter = [...deciding].toSorted((first, second) => first.waiter - second.waiter);
    for (const resolver of byWaiter) {
      const { futures } = resolver.state;
      const position = futures.findIndex((candidate) => resolved.has(candidate));
      const winner =
        futures[position] ?? unreachable('A resolver was found by no future of its own.');
      this.#decide(resolver, { position, value: settled(winner).value });
    }
  }

  /** The decision `waiter` resumes with, its resolver removed as the wait ends. */
  take(waiter: LiveExecution): Decision {
    const resolver = this.#of(waiter);
    if (resolver?.state.kind !== 'resolved') {
      unreachable(`Execution ${waiter.id} resumed before its wait was decided.`);
    }
    this.#heap.remove(resolver.id);
    const { position, value } = resolver.state;
    return { position, value };
  }

  /** Removes `waiter`'s resolver, if it waits: it stops, or resumes on its cleanup (§7). */
  drop(waiter: LiveExecution): void {
    const resolver = this.#of(waiter);
    if (resolver !== undefined) {
      this.#heap.remove(resolver.id);
    }
  }

  #decide(resolver: Resolver, decision: Decision): void {
    this.#heap.replace({ ...resolver, state: { kind: 'resolved', ...decision } });
    this.#decided(this.#heap.of(resolver.waiter, 'execution'), decision);
  }

  #of(waiter: LiveExecution): Resolver | undefined {
    const [resolver] = this.#heap.find('waits', waiter.id);
    return resolver;
  }
}

function isPending(resolver: Resolver): resolver is PendingResolver {
  return resolver.state.kind === 'pending';
}
