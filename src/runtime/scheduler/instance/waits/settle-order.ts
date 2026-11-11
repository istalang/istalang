/**
 * The order in which what is registered on futures resolved together decides (proposal 8, Rule 5;
 * spec §8): per wait, its lowest case; within it, the lowest position among `Resolver.at` ones;
 * among the futures one resolver is registered on, the earliest registration. What decides a wait
 * goes before `Resolver.of` resolvers, which decide nothing themselves, in the order those were
 * made.
 */

import type { Heap } from '../heap.ts';
import { isPending, type PendingResolver, pendingOf } from './resolvers.ts';

/** A pending resolver's registration on a future that resolved, `order`th among its futures. */
export interface Registration {
  readonly resolver: PendingResolver;
  readonly future: number;
  readonly order: number;
}

/**
 * The registrations on `resolved` of the resolvers pending, each at its earliest among them, in
 * the order they decide.
 */
export function settleOrder(heap: Heap, resolved: ReadonlySet<number>): readonly Registration[] {
  return [...registrationsOn(heap, resolved)]
    .map((registration) => ({ registration, rank: rankOf(heap, registration.resolver) }))
    .toSorted(
      (first, second) =>
        compareRanks(first.rank, second.rank) ||
        first.registration.order - second.registration.order,
    )
    .map(({ registration }) => registration);
}

/** The registrations on `resolved` of the resolvers pending, each at its earliest among them. */
function registrationsOn(heap: Heap, resolved: ReadonlySet<number>): Iterable<Registration> {
  const earliest = new Map<number, Registration>();
  for (const future of resolved) {
    for (const resolver of heap.find('resolvers', future).filter(isPending)) {
      const order = resolver.state.on.indexOf(future);
      const known = earliest.get(resolver.id);
      if (known === undefined || order < known.order) {
        earliest.set(resolver.id, { resolver, future, order });
      }
    }
  }
  return earliest.values();
}

/**
 * Where the pending `resolver` ranks among those resolving together, lowest first: what decides a
 * wait, by its waiter's creation then its case, before `Resolver.of` ones, by creation; a
 * `Resolver.at` one as what it decides, then by its position.
 */
function rankOf(heap: Heap, resolver: PendingResolver): readonly bigint[] {
  const { target } = resolver.state;
  if (target.kind === 'at') {
    return [...rankOf(heap, pendingOf(heap, target.done)), target.position];
  }
  return target.kind === 'case'
    ? [0n, BigInt(heap.of(target.wait, 'wait').waiter), BigInt(target.position)]
    : [1n, BigInt(resolver.id)];
}

/** Orders two ranks (`rankOf`) element by element, a prefix first. */
function compareRanks(first: readonly bigint[], second: readonly bigint[]): number {
  for (const [index, element] of first.entries()) {
    const other = second[index];
    if (other === undefined) {
      return 1;
    }
    if (element !== other) {
      return element < other ? -1 : 1;
    }
  }
  return first.length < second.length ? -1 : 0;
}
