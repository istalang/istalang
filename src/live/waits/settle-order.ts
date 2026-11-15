/**
 * The order in which what is registered on futures resolved together decides (proposal 8, Rule 5;
 * spec §8), as the interpreter's (runtime/scheduler/instance/waits/settle-order.ts): per wait, its
 * lowest case, waits by their waiter's creation; within a case, the lowest position among
 * `Resolver.at` ones; among the futures one resolver is registered on, the earliest registration.
 * What decides a wait goes before `Resolver.of` resolvers, which decide nothing themselves, in the
 * order those were made.
 */

import type { Future } from './future.ts';
import type { Resolver } from './resolver.ts';

/** A pending resolver's registration on a future that resolved, `order`th among its futures. */
export interface Registration {
  readonly resolver: Resolver;
  readonly future: Future;
  readonly order: number;
}

/** `registrations`, each pending resolver at its earliest among them, in the order they decide. */
export function settleOrder(registrations: readonly Registration[]): readonly Registration[] {
  const earliest = new Map<Resolver, Registration>();
  for (const registration of registrations) {
    const known = earliest.get(registration.resolver);
    if (
      registration.resolver.state === 'pending' &&
      (known === undefined || registration.order < known.order)
    ) {
      earliest.set(registration.resolver, registration);
    }
  }
  return [...earliest.values()]
    .map((registration) => ({ registration, rank: rankOf(registration.resolver) }))
    .toSorted(
      (first, second) =>
        compareRanks(first.rank, second.rank) ||
        first.registration.order - second.registration.order,
    )
    .map(({ registration }) => registration);
}

/** Where `resolver` ranks among those resolving together, lowest first. */
function rankOf(resolver: Resolver): readonly bigint[] {
  const { target } = resolver;
  switch (target.kind) {
    case 'at':
      return [...rankOf(target.done), target.position];
    case 'case':
      return [0n, BigInt(target.wait.waiter), BigInt(target.position)];
    default:
      return [1n, BigInt(resolver.object)];
  }
}

/** Orders two ranks element by element, a prefix first. */
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
