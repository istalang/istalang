/**
 * The weak side of disposal (spec §6, §7): weak references, and the futures that resolve when
 * what they watch is disposed.
 *
 * - A referent has one weak reference, which the heap finds by its referent rather than the
 *   referent naming it, so `WeakRef(a) == WeakRef(a)` compares like any two handles, also after `a`
 *   is disposed.
 * - A call is watched the same way: `currentCall` gives the weak reference to the call's
 *   execution, and `worker.disposing()` watches it as `disposed()` watches any other referent. A
 *   call that returns was never disposed, so its weak reference loses its target and resolves
 *   nothing, and a `disposing()` taken afterwards never resolves.
 * - A watch is a future pending on a weak reference, which it holds; the weak reference holds
 *   nothing, so watching keeps nothing alive (runtime/lifetimes/holders.ts).
 * - The disposal step reports what it disposes (runtime/lifetimes/): an object once it is gone,
 *   after any code its disposal ran, so code its watches wake sees `deref()` give `none` (spec §6,
 *   "Order"); a call as it is disposed, since a call waiting on its own `disposing()` runs its
 *   cleanup within the disposal (spec §7).
 */

import type { Value } from '../../definition/values.ts';
import { type Futures, waitedOn } from './futures.ts';
import { type Heap, handleObject, type LiveExecution, type LiveObjectOf } from './heap.ts';

export class WeakSide {
  readonly #heap: Heap;
  readonly #futures: Futures;

  constructor(heap: Heap, futures: Futures) {
    this.#heap = heap;
    this.#futures = futures;
  }

  /** A handle to the one weak reference to object `target`, made on first use. */
  reference(target: number): Value {
    const weak =
      this.#referenceTo(target) ?? this.#heap.add((id) => ({ kind: 'weakRef', id, target }));
    return { kind: 'handle', object: weak.id };
  }

  /** The object `weak` refers to, until it is disposed. */
  target(weak: Value): number | undefined {
    return this.#heap.of(handleObject(weak), 'weakRef').target;
  }

  /**
   * A watch on `weak`: a future that resolves when its referent is disposed, and never if it has
   * none left. `worker.disposing()` is one on the call's weak reference.
   */
  watch(weak: Value): Value {
    return this.#futures.createHandle({ kind: 'disposed', weakRef: handleObject(weak) });
  }

  /** `w.disposed()`: a watch on `weak`, already resolved once its referent is disposed. */
  whenDisposed(weak: Value): Value {
    return this.target(weak) === undefined
      ? this.#futures.createHandle({ kind: 'resolved', value: null })
      : this.watch(weak);
  }

  /** Object `id` was disposed and is gone: its weak reference lets go of it, its watches resolve. */
  disposed(id: number): void {
    this.#resolveWatches(id);
  }

  /**
   * The call `execution` runs is being disposed: its `disposing()` watches resolve. When it waits
   * on one of them, it is to resume on that one, whatever else has resolved (§7); that watch.
   */
  disposing(execution: LiveExecution): number | undefined {
    const watches = this.#resolveWatches(execution.id);
    return waitedOn(execution).find((future) => watches.includes(future));
  }

  /** The call `execution` returned, so it can no longer be disposed. */
  onReturned(execution: number): void {
    this.#letGo(execution);
  }

  /** Lets go of `target` and resolves the watches pending on its weak reference; those watches. */
  #resolveWatches(target: number): readonly number[] {
    const watches = this.#letGo(target);
    for (const watch of watches) {
      this.#futures.resolve(watch, null);
    }
    return watches;
  }

  /** Clears the weak reference to `target`, if it has one; the watches pending on it. */
  #letGo(target: number): readonly number[] {
    const weak = this.#referenceTo(target);
    if (weak === undefined) {
      return [];
    }
    this.#heap.replace({ kind: 'weakRef', id: weak.id });
    return this.#heap.find('watches', weak.id).map(({ id }) => id);
  }

  #referenceTo(target: number): LiveObjectOf<'weakRef'> | undefined {
    const [weak] = this.#heap.find('weakRefs', target);
    return weak;
  }
}
