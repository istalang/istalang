/**
 * Memoizing what is derived from an owner that changes in place, such as an inference system
 * (checker/types/inference/system.ts), where `memo` keys by immutable inputs: the owner names its
 * state by a revision instead, so a changed owner reads new values and none is invalidated by hand.
 *
 * A cycle answers as `Entries` does (entries/index.ts): its members are a strongly connected
 * component of what read what (Tarjan's algorithm, run as keys compute), and every member answers
 * the stand-in, which is also what reaching a key still computing answers. So no value depends on
 * which key was asked first, and none computed from a stand-in in a cycle is kept as its own.
 */

/** Values derived from an owner, memoized for one revision of it (the banner). */
export class RevisionMemo<Key, Value> {
  #revision: number | undefined;
  readonly #values = new Map<Key, Value>();
  /** Tarjan's stack: the keys computing, and those computed in a cycle not closed yet. */
  readonly #open: Key[] = [];
  /** Each open key's place on `#open`. */
  readonly #placeOf = new Map<Key, number>();
  /** For each key computing, outermost first, the lowest place on `#open` its computation reached. */
  readonly #reached: number[] = [];

  /**
   * The value `compute` gives for `key` at `revision`, computed the first time it is read there;
   * `whileComputing` for a key in a cycle. `compute` reads the owner, never changes it.
   */
  get(revision: number, key: Key, compute: () => Value, whileComputing: Value): Value {
    if (revision !== this.#revision) {
      this.#values.clear();
      this.#revision = revision;
    }
    if (this.#values.has(key)) {
      return this.#values.get(key) as Value;
    }
    const open = this.#placeOf.get(key);
    if (open !== undefined) {
      this.#reach(open);
      return whileComputing;
    }
    const place = this.#open.length;
    this.#open.push(key);
    this.#placeOf.set(key, place);
    this.#reached.push(Number.POSITIVE_INFINITY);
    const value = compute();
    const reached = this.#reached.pop() ?? Number.POSITIVE_INFINITY;
    if (reached < place) {
      // A member of a cycle closed by a key below it, which decides for it.
      this.#reach(reached);
      return whileComputing;
    }
    const members = this.#open.splice(place);
    for (const member of members) {
      this.#placeOf.delete(member);
      this.#values.set(member, reached === place ? whileComputing : value);
    }
    return reached === place ? whileComputing : value;
  }

  /** Notes that the key computing reached the open key at `place`. */
  #reach(place: number): void {
    const last = this.#reached.length - 1;
    this.#reached[last] = Math.min(this.#reached[last] ?? place, place);
  }
}
