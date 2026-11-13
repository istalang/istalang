/**
 * Values changed in place (docs/work/static-lifetimes/design.md §9.6). A value is immutable to the
 * program: every other holder of it keeps what it holds. So an update writes in place only a node
 * nothing else can see: one this instance copied for writing (`#own`), held once (counts.ts). Any
 * other node is copied at its first write, and the copy is this instance's own from then on, so
 * building a collection one item at a time is linear (tracker P2).
 *
 * - **Never in place:** a constant, which every instance shares; a value a restore shares with
 *   another instance or its snapshot; a value a native or the host made. None is a copy this
 *   instance made for writing, so each is copied once, at its first write.
 * - **A path** is opened from its holder's value down: every node on it is written, so each must
 *   be its own and held once. The first that isn't is copied with every node below it, and the
 *   copy takes its place in its parent, or is the new whole value its holder takes.
 * - **A value going in** that is a node of the path itself (`xs.push(xs)`) is read without a holder
 *   (a native's argument, a store's value), so the path is copied from that node down: a value
 *   never holds itself, and what went in is the value as it was.
 * - **Derived data** keyed by a node's identity, its summary, its hash and a map's table, is
 *   forgotten as the node changes; a map setting an entry keeps its table up to date instead
 *   (foundation/language/values.ts).
 * - **Counts:** a held node holds and lets go of its parts as they change (`partHeld`,
 *   `partReleased`), holding the new before letting go of the old; a copy holds its parts from its
 *   first hold, as any value does.
 */

import {
  deleteEntryInPlace,
  forgetDerived,
  setEntryInPlace,
} from '../../definition/values/equality.ts';
import {
  type CompositeValue,
  childValues,
  elementsOf,
  forgetSummary,
  isComposite,
  mapValueOf,
  type Value,
  withChildValues,
} from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { partAt } from '../interpreter/parts.ts';

/** What changing values in place reads of and tells the counts (counts.ts). */
export interface NodeCounts {
  readonly holdersOfNode: (node: CompositeValue) => number | undefined;
  readonly partHeld: (node: CompositeValue, part: Value) => void;
  readonly partReleased: (node: CompositeValue, part: Value) => void;
}

/**
 * The changes a native makes to the array or map it takes by `&` (runtime/natives.ts), on the
 * value its context opened for changing.
 */
export interface ValueChanges {
  readonly push: (array: CompositeValue, items: readonly Value[]) => void;
  /** Removes the last element; it, or undefined for an empty array. */
  readonly pop: (array: CompositeValue) => Value | undefined;
  readonly reverse: (array: CompositeValue) => void;
  /** Replaces `count` elements from `start` with `items`. */
  readonly splice: (
    array: CompositeValue,
    start: number,
    count: number,
    items: readonly Value[],
  ) => void;
  /** Sets `key` to `value`: a key the map holds keeps its place, a new one goes last. */
  readonly setEntry: (map: CompositeValue, key: Value, value: Value) => void;
  /** Deletes `key`'s entry; whether the map had one. */
  readonly deleteEntry: (map: CompositeValue, key: Value) => boolean;
}

/** A path opened for writing: the whole value its holder is to take, and the nodes along it. */
interface Opened {
  readonly whole: Value;
  readonly nodes: readonly CompositeValue[];
}

export class InPlace implements ValueChanges {
  readonly #counts: NodeCounts;
  /** The nodes this instance copied for writing. */
  readonly #own = new WeakSet<CompositeValue>();

  constructor(counts: NodeCounts) {
    this.#counts = counts;
  }

  /** `whole` with its part at `path` replaced by `part`: the value its holder takes. */
  withPart(whole: Value, path: readonly number[], part: Value): Value {
    const index = path.at(-1);
    if (index === undefined) {
      return part;
    }
    const opened = this.#open(whole, path.slice(0, -1), [part]);
    this.#setPart(lastOf(opened.nodes), index, part);
    return opened.whole;
  }

  /**
   * `whole` with `change` made to its part at `path`, which takes in `inserted`: the value its holder
   * takes, and what `change` gives.
   */
  changed<Result>(
    whole: Value,
    path: readonly number[],
    inserted: readonly Value[],
    change: (node: CompositeValue) => Result,
  ): { readonly whole: Value; readonly result: Result } {
    const opened = this.#open(whole, path, inserted);
    return { whole: opened.whole, result: change(lastOf(opened.nodes)) };
  }

  /** `array` with `items` appended: the value its holder takes. */
  appended(array: Value, items: readonly Value[]): Value {
    return this.changed(array, [], items, (node) => {
      this.push(node, items);
    }).whole;
  }

  /** `map` with each of `entries` set in order: the value its holder takes. */
  withEntries(map: Value, entries: readonly (readonly [Value, Value])[]): Value {
    return this.changed(map, [], entries.flat(), (node) => {
      for (const [key, value] of entries) {
        this.setEntry(node, key, value);
      }
    }).whole;
  }

  readonly push = (array: CompositeValue, items: readonly Value[]): void => {
    const elements = mutableElements(array);
    for (const item of items) {
      elements.push(item);
      this.#counts.partHeld(array, item);
    }
    forgetDerivedOf(array);
  };

  readonly pop = (array: CompositeValue): Value | undefined => {
    const elements = mutableElements(array);
    if (elements.length === 0) {
      return undefined;
    }
    const last = elements.pop() as Value;
    this.#counts.partReleased(array, last);
    forgetDerivedOf(array);
    return last;
  };

  /** A reversal holds what the array held, so no count changes. */
  readonly reverse = reversed;

  readonly splice = (
    array: CompositeValue,
    start: number,
    count: number,
    items: readonly Value[],
  ): void => {
    for (const item of items) {
      this.#counts.partHeld(array, item);
    }
    for (const removed of mutableElements(array).splice(start, count, ...items)) {
      this.#counts.partReleased(array, removed);
    }
    forgetDerivedOf(array);
  };

  readonly setEntry = (map: CompositeValue, key: Value, value: Value): void => {
    this.#counts.partHeld(map, key);
    this.#counts.partHeld(map, value);
    for (const part of setEntryInPlace(mapValueOf(map), key, value) ?? []) {
      this.#counts.partReleased(map, part);
    }
    forgetSummary(map);
  };

  readonly deleteEntry = (map: CompositeValue, key: Value): boolean => {
    const removed = deleteEntryInPlace(mapValueOf(map), key);
    for (const part of removed ?? []) {
      this.#counts.partReleased(map, part);
    }
    forgetSummary(map);
    return removed !== undefined;
  };

  /**
   * The nodes along `path` in `whole`, each this instance's own and held once, copying from the
   * first that isn't, or that `inserted` names, down.
   */
  #open(whole: Value, path: readonly number[], inserted: readonly Value[]): Opened {
    const nodes = [compositeOf(whole)];
    for (const index of path) {
      nodes.push(compositeOf(partAt(lastOf(nodes), [index])));
    }
    const shared = nodes.findIndex(
      (node) =>
        !this.#own.has(node) || this.#counts.holdersOfNode(node) !== 1 || inserted.includes(node),
    );
    const kept = shared === -1 ? nodes : nodes.slice(0, shared);
    // The node changed forgets what it must as it changes; those above it change with it.
    for (const node of kept.slice(0, nodes.length - 1)) {
      forgetDerivedOf(node);
    }
    if (shared === -1) {
      return { whole, nodes };
    }
    const copies = nodes.slice(shared).map((node) => this.#copyOf(node));
    copies.forEach((copy, offset) => {
      const below = copies[offset + 1];
      if (below !== undefined) {
        setChild(copy, path[shared + offset] as number, below);
      }
    });
    const [top] = copies as [CompositeValue, ...CompositeValue[]];
    const parent = kept.at(-1);
    if (parent === undefined) {
      return { whole: top, nodes: copies };
    }
    this.#setPart(parent, path[shared - 1] as number, top);
    return { whole, nodes: [...kept, ...copies] };
  }

  /** Puts `part` at field `index` of `node`, which may change in place. */
  #setPart(node: CompositeValue, index: number, part: Value): void {
    const old = childValues(node)[index] ?? null;
    if (old === part) {
      return;
    }
    setChild(node, index, part);
    this.#counts.partHeld(node, part);
    this.#counts.partReleased(node, old);
    forgetDerivedOf(node);
  }

  /** A copy of `node` this instance owns, holding its parts. */
  #copyOf(node: CompositeValue): CompositeValue {
    const copy = withChildValues(node, childValues(node));
    this.#own.add(copy);
    return copy;
  }
}

/** Forgets what was derived from `node`, which changed in place. */
function forgetDerivedOf(node: CompositeValue): void {
  forgetSummary(node);
  forgetDerived(node);
}

/** Puts `part` at field `index` of `node`, a position among its `childValues`. */
function setChild(node: CompositeValue, index: number, part: Value): void {
  switch (node.kind) {
    case 'tuple':
    case 'array':
      (node.elements as Value[])[index] = part;
      return;
    case 'struct':
    case 'variant':
      (node.fields as Value[])[index] = part;
      return;
    case 'closure':
      (node.captures as Value[])[index] = part;
      return;
    case 'map': {
      const entries = node.entries as (readonly [Value, Value])[];
      const position = Math.floor(index / 2);
      const [key, value] = entries[position] ?? unreachable(`A map has no part ${index}.`);
      entries[position] = index % 2 === 0 ? [part, value] : [key, part];
      return;
    }
    default:
      unreachable(`A ${node.kind} has no parts to write.`);
  }
}

function reversed(array: CompositeValue): void {
  mutableElements(array).reverse();
  forgetDerivedOf(array);
}

function mutableElements(array: CompositeValue): Value[] {
  return elementsOf(array) as Value[];
}

function compositeOf(value: Value): CompositeValue {
  if (!isComposite(value)) {
    unreachable(`A ${typeof value} has no parts to write.`);
  }
  return value;
}

function lastOf(nodes: readonly CompositeValue[]): CompositeValue {
  return nodes.at(-1) ?? unreachable('An opened path has its whole value at least.');
}
