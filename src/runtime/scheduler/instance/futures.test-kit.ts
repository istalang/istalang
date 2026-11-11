/** Futures a test makes alone: what their resolving decides or answers goes nowhere. */

import type { Value } from '../../../definition/values/values.ts';
import { DisposalNotices } from './disposal-notices.ts';
import { Futures } from './futures.ts';
import { Heap } from './heap.ts';
import { Waits } from './waits/index.ts';

/** A callback a resolver called, with the values it was called with. */
type CalledBack = readonly [Value, readonly Value[]];

/** Futures on `heap`, their decisions, callbacks and answers ignored. */
export function futuresOn(heap: Heap): Futures {
  return waitsAndFutures(heap, () => undefined).futures;
}

/** Waits and futures on a heap of their own, the callbacks their resolvers call kept in `calls`. */
export function recordingFutures() {
  const heap = new Heap([]);
  const calls: CalledBack[] = [];
  const made = waitsAndFutures(heap, (callback, argumentValues) => {
    calls.push([callback, argumentValues]);
  });
  return { heap, calls, ...made };
}

function waitsAndFutures(
  heap: Heap,
  called: (callback: Value, argumentValues: readonly Value[]) => void,
): { readonly waits: Waits; readonly futures: Futures } {
  const waits = new Waits(heap, {
    decided: () => undefined,
    watchesCall: () => false,
    called,
    awaited: () => undefined,
    givenUp: () => undefined,
  });
  return { waits, futures: new Futures(heap, waits, new DisposalNotices(), () => undefined) };
}
