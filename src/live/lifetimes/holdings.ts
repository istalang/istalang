/**
 * What each counted object of a run of compiled code holds (spec §6, §7), derived from its state
 * and the waits' indexes, as the interpreter's holdings say it (runtime/snapshot/holdings.ts,
 * `Heap.held`), so the two runtimes hold alike.
 *
 * - A cell holds its value, and a resource nothing.
 * - A future holds its value once settled, and the pending resolvers of a callback's chain
 *   registered on it: only its futures can resolve those.
 * - A wait holds its value once decided, and those of its case resolvers still awaited.
 * - A pending resolver holds its callbacks, and a `Resolver.at` one the resolver it decides. One of
 *   a wait case's chain, held from the wait down, holds the futures it is registered on and the
 *   awaited `Resolver.at` ones deciding it.
 * - What an object's holdings read of another (a resolver's state, its registrations) makes that
 *   other's change one of its own: `readersOf`.
 */

import type { Value } from '../../definition/values/values.ts';
import type { Counts } from '../../runtime/lifetimes/counts.ts';
import { Cell } from '../values/cell.ts';
import type { Resource } from '../values/resource.ts';
import { Future } from '../waits/future.ts';
import { Resolver } from '../waits/resolver.ts';
import { Wait } from '../waits/wait.ts';

/** What one holder holds: the values, and the counted objects it holds directly. */
export type Held = Parameters<Counts['changed']>[0];

/** A counted object of a run. */
export type Counted = Cell | Resource | Future | Wait | Resolver;

/** What holdings read of the waits' indexes (waits.ts). */
export interface WaitIndexes {
  /** The resolvers registered on `future`, in the order they were. */
  readonly registeredOn: (future: Future) => readonly Resolver[];
  /** `wait`'s cases' resolvers. */
  readonly casesOf: (wait: Wait) => readonly Resolver[];
}

/** What `object` holds now. */
export function heldBy(indexes: WaitIndexes, object: Counted): Held {
  if (object instanceof Cell) {
    return { values: [object.v], holds: [] };
  }
  if (object instanceof Future) {
    return {
      values: settledValue(object.settled),
      holds: ids(
        indexes
          .registeredOn(object)
          .filter((resolver) => resolver.state === 'pending' && !heldFromRoot(resolver)),
      ),
    };
  }
  if (object instanceof Resolver) {
    return resolverHolds(object);
  }
  if (object instanceof Wait) {
    return {
      values: settledValue(object.decision),
      holds: ids(awaited(indexes.casesOf(object))),
    };
  }
  return { values: [], holds: [] };
}

/** The objects whose holdings read `object`'s state: for a resolver, its futures, wait and target. */
export function readersOf(object: Counted): readonly Counted[] {
  if (!(object instanceof Resolver)) {
    return [];
  }
  return [...object.on, ...decidedBy(object)];
}

/** What `resolver` decides, a wait or another resolver; nothing for a callback's. */
function decidedBy({ target }: Resolver): readonly Counted[] {
  switch (target.kind) {
    case 'case':
      return [target.wait];
    case 'at':
      return [target.done];
    default:
      return [];
  }
}

function resolverHolds(resolver: Resolver): Held {
  if (resolver.state !== 'pending') {
    return { values: [], holds: [] };
  }
  const { target } = resolver;
  const values = [...(target.kind === 'callback' ? [target.callback] : []), ...resolver.onCancel];
  const decides = target.kind === 'at' ? [target.done] : [];
  return heldFromRoot(resolver)
    ? {
        values,
        holds: ids([...resolver.on, ...decides, ...awaited(resolver.positions)]),
      }
    : { values, holds: ids(decides) };
}

/** Whether `resolver`'s chain is a wait case's, held from the wait down (`isHeldFromRoot`). */
function heldFromRoot(resolver: Resolver): boolean {
  return resolver.root.target.kind === 'case';
}

/**
 * The pending ones of `resolvers` something can still resolve: registered on a future, or decided
 * by a `Resolver.at` one that is (`Heap.#awaited`).
 */
function awaited(resolvers: readonly Resolver[]): readonly Resolver[] {
  return resolvers.filter(
    (resolver) =>
      resolver.state === 'pending' &&
      (resolver.on.length > 0 || awaited(resolver.positions).length > 0),
  );
}

function settledValue(settled: { readonly value: Value } | undefined): readonly Value[] {
  return settled === undefined ? [] : [settled.value];
}

function ids(objects: readonly { readonly object: number }[]): readonly number[] {
  return objects.map(({ object }) => object);
}
