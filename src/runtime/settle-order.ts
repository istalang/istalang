/**
 * The order in which what is registered on futures resolved together decides (proposal 8, Rule 5;
 * spec §8), for every runtime, whatever it keeps of a resolver: per wait, its lowest case, waits by
 * their waiter's creation; within a case, the lowest position among `Resolver.at` ones; among the
 * futures one resolver is registered on, the earliest registration. What decides a wait goes before
 * `Resolver.of` resolvers, which decide nothing themselves, in the order those were made.
 */

/** What the order reads of a pending resolver: what it decides. */
export type RankedTarget<Resolver> =
  | { readonly kind: 'case'; readonly waiter: number; readonly position: number }
  | { readonly kind: 'at'; readonly done: Resolver; readonly position: bigint }
  | { readonly kind: 'callback'; readonly made: number };

/** A pending resolver's registration on a future that resolved, `order`th among its futures. */
export interface Registration<Resolver, Future> {
  readonly resolver: Resolver;
  readonly future: Future;
  readonly order: number;
}

/**
 * `registrations` of pending resolvers, each resolver at its earliest among them, in the order they
 * decide; `targetOf` says what each decides.
 */
export function settleOrder<Resolver, Future>(
  registrations: readonly Registration<Resolver, Future>[],
  targetOf: (resolver: Resolver) => RankedTarget<Resolver>,
): readonly Registration<Resolver, Future>[] {
  const earliest = new Map<Resolver, Registration<Resolver, Future>>();
  for (const registration of registrations) {
    const known = earliest.get(registration.resolver);
    if (known === undefined || registration.order < known.order) {
      earliest.set(registration.resolver, registration);
    }
  }
  const rankOf = (resolver: Resolver): readonly bigint[] => {
    const target = targetOf(resolver);
    switch (target.kind) {
      case 'at':
        return [...rankOf(target.done), target.position];
      case 'case':
        return [0n, BigInt(target.waiter), BigInt(target.position)];
      default:
        return [1n, BigInt(target.made)];
    }
  };
  return [...earliest.values()]
    .map((registration) => ({ registration, rank: rankOf(registration.resolver) }))
    .toSorted(
      (first, second) =>
        compareRanks(first.rank, second.rank) ||
        first.registration.order - second.registration.order,
    )
    .map(({ registration }) => registration);
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
