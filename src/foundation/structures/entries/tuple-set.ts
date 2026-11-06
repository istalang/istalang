/**
 * A set of tuples whose items compare by identity, such as an input's name and arguments: a tuple
 * is a member when it was added with the same items in the same order. It keeps its tuples as a
 * tree of their prefixes, so adding one costs a lookup per item, whatever the set holds.
 */

/** One prefix of the tuples added: the longer ones under it, and whether it was added itself. */
interface Prefix {
  readonly next: Map<unknown, Prefix>;
  added: boolean;
}

export class TupleSet {
  readonly #root: Prefix = { next: new Map(), added: false };

  /** Adds `tuple`; whether it wasn't a member yet. */
  add(tuple: readonly unknown[]): boolean {
    let prefix = this.#root;
    for (const item of tuple) {
      let next = prefix.next.get(item);
      if (next === undefined) {
        next = { next: new Map(), added: false };
        prefix.next.set(item, next);
      }
      prefix = next;
    }
    const isNew = !prefix.added;
    prefix.added = true;
    return isNew;
  }
}
