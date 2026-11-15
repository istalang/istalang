/**
 * The heap's resolvers in the order what is registered on futures resolved together decides
 * (../../../settle-order.ts, the order every runtime reads).
 */

import { type Registration, settleOrder } from '../../../settle-order.ts';
import type { Heap } from '../heap.ts';
import { isPending, type PendingResolver, pendingOf } from './resolvers.ts';

/**
 * The registrations on `resolved` of the resolvers pending, each at its earliest among them, in
 * the order they decide.
 */
export function heapSettleOrder(
  heap: Heap,
  resolved: ReadonlySet<number>,
): readonly Registration<PendingResolver, number>[] {
  const registrations = [...resolved].flatMap((future) =>
    heap
      .find('resolvers', future)
      .filter(isPending)
      .map((resolver) => ({ resolver, future, order: resolver.state.on.indexOf(future) })),
  );
  return settleOrder(registrations, (resolver) => {
    const { target } = resolver.state;
    switch (target.kind) {
      case 'at':
        return { kind: 'at', done: pendingOf(heap, target.done), position: target.position };
      case 'case':
        return {
          kind: 'case',
          waiter: heap.of(target.wait, 'wait').waiter,
          position: target.position,
        };
      default:
        return { kind: 'callback', made: resolver.id };
    }
  });
}
