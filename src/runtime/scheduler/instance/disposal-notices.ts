/**
 * What observes, from outside the language, the disposal of an object the runtime disposes itself
 * (§7): a pending live future a host's resolver resolves (proposal 8, Rule 9), or a runtime live
 * code opened (§9). Each observer is kept in memory, as one outside the language is, and told once:
 * at once in a live run, and once the segment commits in an instance, so a segment a crash
 * discards tells nothing.
 */

import type { Waiting } from '../waiting.ts';
import type { Heap } from './heap.ts';

export class DisposalNotices {
  readonly #heap: Heap;
  readonly #notices = new Map<number, (() => void)[]>();
  /** What observes the objects this segment disposed, told once it commits. */
  #committing: (() => void)[] = [];

  constructor(heap: Heap) {
    this.#heap = heap;
  }

  /** Has `notice` told once the object `id` is disposed. */
  onDisposed(id: number, notice: () => void): void {
    this.#notices.set(id, [...(this.#notices.get(id) ?? []), notice]);
  }

  /** Forgets what observes the object `id`, which can no longer be disposed unresolved. */
  forget(id: number): void {
    this.#notices.delete(id);
  }

  /** The object `id` was disposed, in a run waiting `waiting`'s way: what observes it is told. */
  disposed(id: number, waiting: Waiting['kind']): void {
    const notices = this.#notices.get(id) ?? [];
    this.#notices.delete(id);
    if (waiting === 'live') {
      for (const notice of notices) {
        notice();
      }
      return;
    }
    this.#committing.push(...notices);
  }

  /** Tells what observed the objects this segment disposed, as the segment committed. */
  tellCommitted(): void {
    for (const notice of this.#committing.splice(0)) {
      notice();
    }
  }

  /**
   * Forgets the observers of objects no longer on the heap, left out unseen as a commit leaves out
   * what nothing holds, so a later object reusing an id isn't observed, and what a segment that
   * never committed would have told.
   */
  forgetGone(): void {
    this.#committing = [];
    for (const id of this.#notices.keys()) {
      if (!this.#heap.has(id)) {
        this.#notices.delete(id);
      }
    }
  }
}
