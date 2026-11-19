/**
 * Weak references (§16): each disposable has at most one, made the first time it is asked for, which
 * holds nothing. Its referent's disposal clears it, and settles its `disposed()` future if one was
 * asked for; it refers to none from the moment the last holder lets go, though the disposal may be
 * yet to come in its round, so no `dispose` brings a released value back.
 */

import type { RunObject } from './objects/run-object.ts';
import { WeakReference } from './objects/weak-reference.ts';

export class WeakReferences {
  readonly #byTarget = new WeakMap<RunObject, WeakReference>();

  /** The one weak reference to `target`, made with identity `id()` the first time. */
  of(target: RunObject, id: () => number): WeakReference {
    const known = this.#byTarget.get(target);
    if (known !== undefined) {
      return known;
    }
    const made = new WeakReference(id(), target);
    this.#byTarget.set(target, made);
    return made;
  }

  /** Remembers `weak` as the one weak reference to its target, as a snapshot read back gives it. */
  restored(weak: WeakReference): void {
    if (weak.target !== undefined) {
      this.#byTarget.set(weak.target, weak);
    }
  }

  /** Clears the weak reference to `target`, which is being disposed; that reference, if any. */
  cleared(target: RunObject): WeakReference | undefined {
    const weak = this.#byTarget.get(target);
    if (weak !== undefined) {
      weak.target = undefined;
    }
    return weak;
  }
}

/** What `weak` refers to while something holds it. */
export function referentOf(weak: WeakReference): RunObject | undefined {
  const { target } = weak;
  return target !== undefined && target.count > 0 ? target : undefined;
}
