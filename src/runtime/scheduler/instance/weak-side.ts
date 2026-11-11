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

import { handleTo, type Value } from '../../../definition/values/values.ts';
import type { NativeWeakSide } from '../../natives.ts';
import type { Futures } from './futures.ts';
import { type Heap, handleObject, type LiveExecution, type LiveObjectOf } from './heap.ts';

export class WeakSide implements NativeWeakSide {
  readonly #heap: Heap;
  readonly #futures: Futures;

  constructor(heap: Heap, futures: Futures) {
    this.#heap = heap;
    this.#futures = futures;
  }

  /** A handle to the one weak reference to `referent`, made on first use. */
  reference(referent: Value): Value {
    const target = handleObject(referent);
    const weak =
      this.#referenceTo(target) ?? this.#heap.add((id) => ({ kind: 'weakRef', id, target }));
    return handleTo(weak.id);
  }

  /** A handle to what `weak` refers to, until it is disposed. */
  target(weak: Value): Value | undefined {
    const { target } = this.#heap.of(handleObject(weak), 'weakRef');
    return typeof target === 'number' ? handleTo(target) : undefined;
  }

  /**
   * A watch on `weak` (`w.disposed()`, `worker.disposing()`): a future that resolves when its
   * referent is disposed, already resolved once a non-call referent was, and never once a call
   * entered cleanup or returned.
   */
  watch(weak: Value): Value {
    const reference = this.#heap.of(handleObject(weak), 'weakRef');
    return reference.target === 'disposed'
      ? this.#futures.createHandle({ kind: 'resolved', value: null })
      : this.#futures.createHandle({ kind: 'disposed', weakRef: reference.id });
  }

  /**
   * Object `id` was disposed and is gone: its weak reference lets go of it, its watches resolve.
   */
  disposed(id: number): void {
    this.#resolveWatches(id, 'disposed');
  }

  /** The call `execution` runs is being disposed: its `disposing()` watches resolve (§7). */
  disposing(execution: LiveExecution): void {
    this.#resolveWatches(execution.id, 'callEnded');
  }

  /** Whether `future` is a pending `disposing()` watch on the call `execution` runs (§7). */
  watchesCall(execution: LiveExecution, future: number): boolean {
    const weak = this.#referenceTo(execution.id);
    return (
      weak !== undefined && this.#heap.find('watches', weak.id).some(({ id }) => id === future)
    );
  }

  /** The call `execution` returned, so it can no longer be disposed. */
  onReturned(execution: number): void {
    this.#letGo(execution, 'callEnded');
  }

  /** Lets go of `target` and resolves the watches pending on its weak reference, together. */
  #resolveWatches(target: number, gone: 'disposed' | 'callEnded'): void {
    const watches = this.#letGo(target, gone);
    this.#futures.resolveTogether(watches.map((id) => ({ id, value: null })));
  }

  /**
   * Clears the weak reference to `target`, if it has one, marking why; the watches pending on it.
   */
  #letGo(target: number, gone: 'disposed' | 'callEnded'): readonly number[] {
    const weak = this.#referenceTo(target);
    if (weak === undefined) {
      return [];
    }
    this.#heap.replace({ kind: 'weakRef', id: weak.id, target: gone });
    return this.#heap.find('watches', weak.id).map(({ id }) => id);
  }

  #referenceTo(target: number): LiveObjectOf<'weakRef'> | undefined {
    const [weak] = this.#heap.find('weakRefs', target);
    return weak;
  }
}
