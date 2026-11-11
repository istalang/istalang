/**
 * What observes, from outside the language, the disposal of an object the runtime disposes itself
 * (§7): a pending live future a host's resolver resolves (proposal 8, Rule 9), or a runtime live
 * code opened (§9). Only live code makes such objects, so observers live in a live run, which
 * never commits: each is kept in memory, as one outside the language is, and told at once.
 */

export class DisposalNotices {
  readonly #notices = new Map<number, (() => void)[]>();

  /** Has `notice` told once the object `id` is disposed. */
  onDisposed(id: number, notice: () => void): void {
    this.#notices.set(id, [...(this.#notices.get(id) ?? []), notice]);
  }

  /** Forgets what observes the object `id`, which can no longer be disposed unresolved. */
  forget(id: number): void {
    this.#notices.delete(id);
  }

  /** The object `id` was disposed: what observes it is told. */
  disposed(id: number): void {
    const notices = this.#notices.get(id) ?? [];
    this.#notices.delete(id);
    for (const notice of notices) {
      notice();
    }
  }
}
