/** A weak reference (§7): it refers to a disposable without holding it, cleared as it goes. */

import type { Future } from './future.ts';
import { RunObject } from './run-object.ts';

export class WeakReference extends RunObject {
  target: RunObject | undefined;
  /** What its `disposed()` gives (§7), made the first time it is asked for. */
  whenDisposed: Future | undefined;

  /** The one weak reference to its target, which `WeakRef(x)` gives out again (§7). */
  override readonly endsWithDisposal = false;

  constructor(id: number, target: RunObject) {
    super(id);
    this.target = target;
  }
}
