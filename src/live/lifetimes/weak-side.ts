/**
 * The weak side of disposal in a run of compiled code (spec §6, §7): weak references, and the
 * futures that resolve when what they watch is disposed, as the interpreter's
 * (runtime/scheduler/instance/weak-side.ts).
 *
 * - A referent has one weak reference, so `WeakRef(a) == WeakRef(a)`, also after `a` is gone.
 * - A call is watched the same way: `currentCall` gives the weak reference to the call's future,
 *   and `worker.disposing()` watches it. A call that returns was never disposed, so its weak
 *   reference loses its target and resolves nothing.
 * - `deref()` gives nothing once its referent has no holder, before it is disposed: no one may
 *   hold it again.
 * - A watch is a future the weak reference resolves, holding nothing: weak references are never
 *   counted, so watching keeps nothing alive.
 */

import type { Value } from '../../definition/values/values.ts';
import type { NativeWeakSide } from '../../runtime/natives.ts';
import { newObject } from '../values/cell.ts';
import type { Future } from '../waits/future.ts';
import type { Counted } from './holdings.ts';

/** A weak reference: a handle of its own, to what it refers to until that is gone. */
interface WeakReference {
  readonly handle: Value;
  target: Counted | 'disposed' | 'callEnded';
  readonly watches: Future[];
}

/** What the weak side reaches of the run. */
export interface WeakSeams {
  /** A new pending future a watch resolves. */
  readonly watchFuture: () => Future;
  /** A new future, resolved. */
  readonly resolvedFuture: () => Future;
  /** Resolves `futures` together, each with nothing. */
  readonly resolveTogether: (futures: readonly Future[]) => void;
  /** How many holders `object` has; undefined once it is gone, or for one never counted. */
  readonly holdersOf: (object: Counted) => number | undefined;
}

export class LiveWeakSide implements NativeWeakSide {
  readonly #seams: WeakSeams;
  readonly #byReferent = new WeakMap<object, WeakReference>();
  readonly #byHandle = new WeakMap<object, WeakReference>();

  constructor(seams: WeakSeams) {
    this.#seams = seams;
  }

  /** A handle to the one weak reference to `referent`, made on first use. */
  reference(referent: Value): Value {
    const known = this.#byReferent.get(referent as object);
    if (known !== undefined) {
      return known.handle;
    }
    const handle: Value = { kind: 'handle', object: newObject() };
    const reference: WeakReference = { handle, target: referent as Counted, watches: [] };
    this.#byReferent.set(referent as object, reference);
    this.#byHandle.set(handle as object, reference);
    return handle;
  }

  /** What `weak` refers to, until its referent's last holder lets go of it (spec §7). */
  target(weak: Value): Value | undefined {
    const { target } = this.#of(weak);
    return typeof target === 'object' && this.#seams.holdersOf(target) !== 0 ? target : undefined;
  }

  /**
   * A watch on `weak` (`w.disposed()`, `worker.disposing()`): a future that resolves when its
   * referent is disposed, already resolved once a non-call referent was, never once a call entered
   * cleanup or returned.
   */
  watch(weak: Value): Value {
    const reference = this.#of(weak);
    if (reference.target === 'disposed') {
      return this.#seams.resolvedFuture();
    }
    const future = this.#seams.watchFuture();
    if (reference.target !== 'callEnded') {
      reference.watches.push(future);
    }
    return future;
  }

  /** `object` is gone, disposed or not: its weak reference lets go of it, its watches resolve. */
  disposed(object: Counted): void {
    this.#resolveWatches(object, 'disposed');
  }

  /** The call of future `call` is being disposed: its `disposing()` watches resolve (§7). */
  disposing(call: Future): void {
    this.#resolveWatches(call, 'callEnded');
  }

  /** Whether `future` is a pending `disposing()` watch on the call of future `call` (§7). */
  watchesCall(call: Future, future: Future): boolean {
    return this.#byReferent.get(call)?.watches.includes(future) === true;
  }

  /** The call of future `call` returned, so it can no longer be disposed. */
  returned(call: Future): void {
    const reference = this.#byReferent.get(call);
    if (reference !== undefined) {
      reference.target = 'callEnded';
      reference.watches.length = 0;
    }
  }

  #resolveWatches(referent: Counted, gone: 'disposed' | 'callEnded'): void {
    const reference = this.#byReferent.get(referent);
    if (reference === undefined || typeof reference.target !== 'object') {
      return;
    }
    reference.target = gone;
    this.#seams.resolveTogether(reference.watches.splice(0));
  }

  #of(weak: Value): WeakReference {
    const reference = this.#byHandle.get(weak as object);
    if (reference === undefined) {
      throw new Error('Not a weak reference of this run.');
    }
    return reference;
  }
}
