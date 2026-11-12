/**
 * The state of the lifetime analysis at one point of a body (design.md §5.2): which values may
 * reach which, alias, share, and are reachable from code the body doesn't see. Its values are
 * nodes: the body's variables and temporaries, the cells of captured `let`s, the parts a read
 * names, and its inputs as it was given them (analysis.ts names them).
 *
 * - **`a ⇝ b` (reach):** some handle reachable through what `a` holds is one `b` holds directly.
 *   **Alias:** `a` and `b` hold one handle directly. **Share:** they reach one handle at all, so
 *   reach and alias imply share. All are may-relations: a pair absent is a pair that can't hold.
 * - **Escaped:** what callers, other executions or unseen code may also reach.
 * - **Updates are weak.** A node's own relations are replaced only when it is given a new value
 *   (`fresh`); what a write adds to what reaches its holder is only ever added, since the holder's
 *   other paths still stand.
 * - Mutable, so one operation's update is no copy; the runner copies at each block's start
 *   (`clone`), and paths join by union.
 */

export type NodeId = number;

/**
 * Which pairs the nodes' types allow at all (the declaration graph's answer): a relation they
 * forbid can't hold, so it is never added, whatever it would be inherited from.
 */
export interface Allowed {
  readonly reach: (from: NodeId, to: NodeId) => boolean;
  readonly alias: (first: NodeId, second: NodeId) => boolean;
  readonly share: (first: NodeId, second: NodeId) => boolean;
}

const anything: Allowed = { reach: () => true, alias: () => true, share: () => true };

type Pairs = Map<NodeId, Set<NodeId>>;

export class ReachState {
  readonly #reach: Pairs = new Map();
  readonly #alias: Pairs = new Map();
  readonly #share: Pairs = new Map();
  readonly #escaped = new Set<NodeId>();
  readonly #leaked = new Set<NodeId>();
  readonly #live = new Set<NodeId>();

  readonly #allowed: Allowed;

  constructor(allowed: Allowed = anything) {
    this.#allowed = allowed;
  }

  clone(): ReachState {
    const copy = new ReachState(this.#allowed);
    copy.join(this);
    return copy;
  }

  /** Joins `other` in; whether anything was added. */
  join(other: ReachState): boolean {
    const before = this.size();
    joined(this.#reach, other.#reach);
    joined(this.#alias, other.#alias);
    joined(this.#share, other.#share);
    for (const each of other.#escaped) {
      this.#escaped.add(each);
    }
    for (const each of other.#leaked) {
      this.#leaked.add(each);
    }
    for (const each of other.#live) {
      this.#live.add(each);
    }
    return this.size() !== before;
  }

  /** How many facts the state holds; it only grows along a path's joins. */
  size(): number {
    return (
      countOf(this.#reach) +
      countOf(this.#alias) +
      countOf(this.#share) +
      this.#escaped.size +
      this.#leaked.size +
      this.#live.size
    );
  }

  isLive(node: NodeId): boolean {
    return this.#live.has(node);
  }

  live(): readonly NodeId[] {
    return [...this.#live];
  }

  isEscaped(node: NodeId): boolean {
    return this.#escaped.has(node);
  }

  escaped(): readonly NodeId[] {
    return [...this.#escaped].filter((node) => this.#live.has(node));
  }

  /** What the body handed code it doesn't see, which that code may keep and reach again. */
  leaked(): readonly NodeId[] {
    return [...this.#leaked].filter((node) => this.#live.has(node));
  }

  reaches(from: NodeId, to: NodeId): boolean {
    return this.#reach.get(from)?.has(to) ?? false;
  }

  aliases(first: NodeId, second: NodeId): boolean {
    return first === second || (this.#alias.get(first)?.has(second) ?? false);
  }

  shares(first: NodeId, second: NodeId): boolean {
    return first === second || (this.#share.get(first)?.has(second) ?? false);
  }

  /** Whether `value` may reach or be what `holder` holds directly: writing it in closes a cycle. */
  closes(holder: NodeId, value: NodeId): boolean {
    return this.reaches(value, holder) || this.aliases(value, holder);
  }

  /** The nodes `node` may reach. */
  reachedFrom(node: NodeId): readonly NodeId[] {
    return [...(this.#reach.get(node) ?? [])];
  }

  /** The nodes `node` may alias. */
  aliasesOf(node: NodeId): readonly NodeId[] {
    return [...(this.#alias.get(node) ?? [])];
  }

  /** The nodes `node` may share with. */
  sharesOf(node: NodeId): readonly NodeId[] {
    return [...(this.#share.get(node) ?? [])];
  }

  /** Ends `node`'s value: it relates to nothing, and is no longer live. */
  kill(node: NodeId): void {
    for (const pairs of [this.#reach, this.#alias, this.#share]) {
      pairs.delete(node);
      for (const related of pairs.values()) {
        related.delete(node);
      }
    }
    this.#escaped.delete(node);
    this.#leaked.delete(node);
    this.#live.delete(node);
  }

  /** Gives `node` a new value, related to nothing yet. */
  fresh(node: NodeId): void {
    this.kill(node);
    this.#live.add(node);
  }

  addReach(from: NodeId, to: NodeId): void {
    if ((from !== to || this.#live.has(from)) && this.#allowed.reach(from, to)) {
      added(this.#reach, from, to);
      this.addShare(from, to);
    }
  }

  addAlias(first: NodeId, second: NodeId): void {
    if (first !== second && this.#allowed.alias(first, second)) {
      added(this.#alias, first, second);
      added(this.#alias, second, first);
      this.addShare(first, second);
    }
  }

  addShare(first: NodeId, second: NodeId): void {
    if (first !== second && this.#allowed.share(first, second)) {
      added(this.#share, first, second);
      added(this.#share, second, first);
    }
  }

  /** `into` is a copy of `from`: one value, related as it is. */
  copy(into: NodeId, from: NodeId): void {
    if (into === from) {
      return;
    }
    this.fresh(into);
    this.addAlias(into, from);
    this.#contained(into, from);
  }

  /** `into` holds directly what `part` holds directly, as a struct or array made of it does. */
  contain(into: NodeId, part: NodeId): void {
    this.addAlias(into, part);
    this.#contained(into, part);
  }

  #reachersOf(node: NodeId): readonly NodeId[] {
    return [...this.#live].filter((each) => this.reaches(each, node));
  }

  /** What `into` gets of `part`'s relations when it holds what `part` holds directly. */
  #contained(into: NodeId, part: NodeId, apart?: ReadonlySet<NodeId>): void {
    const kept = (each: NodeId) => apart?.has(each) !== true;
    for (const each of this.aliasesOf(part).filter(kept)) {
      this.addAlias(into, each);
    }
    for (const each of this.reachedFrom(part).filter(kept)) {
      this.addReach(into, each);
    }
    for (const each of this.#reachersOf(part).filter(kept)) {
      this.addReach(each, into);
    }
    for (const each of this.sharesOf(part).filter(kept)) {
      this.addShare(into, each);
    }
    if (this.#escaped.has(part)) {
      this.#escaped.add(into);
    }
  }

  /** `into`, a handle made just now, holds `part` in its cell. */
  hold(into: NodeId, part: NodeId): void {
    this.addReach(into, part);
    for (const each of [...this.reachedFrom(part), ...this.aliasesOf(part)]) {
      this.addReach(into, each);
    }
    for (const each of this.sharesOf(part)) {
      this.addShare(into, each);
    }
  }

  /**
   * `into` may reach something `node` reaches: it shares with `node`, and with what reaches or
   * holds `node`, which reaches that too.
   */
  share(into: NodeId, node: NodeId): void {
    this.addShare(into, node);
    for (const each of this.#live) {
      if (each !== into && (this.reaches(each, node) || this.aliases(each, node))) {
        this.addShare(into, each);
      }
    }
  }

  /**
   * `into` is something reachable through `from`'s handles: a cell's value, a future's; related to
   * none of `apart`, which are other parts of `from`.
   */
  readThrough(into: NodeId, from: NodeId, apart?: ReadonlySet<NodeId>): void {
    const kept = (each: NodeId) => each !== into && apart?.has(each) !== true;
    const reached = this.reachedFrom(from).filter(kept);
    const sharing = [...this.#live].filter((each) => kept(each) && this.shares(each, from));
    const shared = this.sharesOf(from).filter(kept);
    this.addReach(from, into);
    for (const each of reached) {
      this.addReach(into, each);
      this.addAlias(into, each);
    }
    for (const each of sharing) {
      this.addReach(each, into);
    }
    for (const each of shared) {
      this.addShare(into, each);
    }
    if (this.#escaped.has(from)) {
      this.#escaped.add(into);
    }
  }

  /**
   * `into` is a part of `from`'s value: a field, an element, what an optional holds; related to
   * none of `apart`, which are other parts of `from`.
   */
  readPart(into: NodeId, from: NodeId, apart?: ReadonlySet<NodeId>): void {
    this.addAlias(into, from);
    this.#contained(into, from, apart);
  }

  /**
   * What reaches `holder`, or holds it, comes to reach `value`, written into its cell, or, not
   * `exact`, into one it reaches, which what shares with it may reach too; with `inside`, only
   * what `value` reaches, as when a part of its value is written there.
   */
  link(
    holder: NodeId,
    value: NodeId,
    { exact, inside }: { exact: boolean; inside: boolean },
  ): void {
    const reaching = [...this.#live].filter(
      (each) =>
        each === holder ||
        this.reaches(each, holder) ||
        this.aliases(each, holder) ||
        (!exact && this.shares(each, holder)),
    );
    const reached = [
      ...(inside ? [] : [value, ...this.aliasesOf(value)]),
      ...this.reachedFrom(value),
    ];
    for (const each of reaching) {
      for (const target of reached) {
        this.addReach(each, target);
      }
      this.addShare(each, value);
      for (const target of this.sharesOf(value)) {
        this.addShare(each, target);
      }
    }
    if (this.#escaped.has(holder)) {
      this.escape(value);
    }
  }

  /** `node` and everything it reaches or holds are handed to code the body doesn't see. */
  escape(node: NodeId): void {
    if (!this.#live.has(node)) {
      return;
    }
    for (const each of [node, ...this.reachedFrom(node), ...this.aliasesOf(node)]) {
      this.#escaped.add(each);
      this.#leaked.add(each);
    }
  }

  /** Marks `node` reachable from unseen code, and nothing else. */
  markEscaped(node: NodeId): void {
    if (this.#live.has(node)) {
      this.#escaped.add(node);
    }
  }
}

function joined(into: Pairs, from: Pairs): void {
  for (const [node, related] of from) {
    const existing = into.get(node);
    if (existing === undefined) {
      into.set(node, new Set(related));
    } else {
      for (const each of related) {
        existing.add(each);
      }
    }
  }
}

function added(pairs: Pairs, from: NodeId, to: NodeId): void {
  const existing = pairs.get(from);
  if (existing === undefined) {
    pairs.set(from, new Set([to]));
  } else {
    existing.add(to);
  }
}

function countOf(pairs: Pairs): number {
  let count = 0;
  for (const related of pairs.values()) {
    count += related.size;
  }
  return count;
}
