/**
 * A relation between an analysis's nodes (reach-state.ts), as rows of bits: one row per node
 * related to any, one bit per node it relates to, by the analysis's numbering (node-numbering.ts).
 *
 * - **Bits, not sets.** The analysis's relations run dense, most live values reaching most others,
 *   and every write adds a row's worth of pairs that mostly hold already, at each pass over a loop:
 *   a bit set again, or a row joined into another, costs a word, where a set pays a hash per pair.
 * - **A row stays as wide as its highest bit needs.** The bitset widens itself to twice the width
 *   of a wider row joined into it, so two rows joined into each other in turn would keep doubling;
 *   a row a join widened is trimmed back.
 * - A row lists its nodes in the order they were numbered.
 */

import { TypedFastBitSet } from 'typedfastbitset';
import type { NodeNumbering } from './node-numbering.ts';
import type { NodeId } from './reach-state.ts';

export class NodeRelation {
  readonly #rows = new Map<NodeId, TypedFastBitSet>();
  readonly #numbering: NodeNumbering;

  constructor(numbering: NodeNumbering) {
    this.#numbering = numbering;
  }

  has(from: NodeId, to: NodeId): boolean {
    const number = this.#numbering.numberOf(to);
    return number !== undefined && this.#rows.get(from)?.has(number) === true;
  }

  add(from: NodeId, to: NodeId): void {
    this.#rowOf(from).add(this.#numbering.number(to));
  }

  /** The nodes `from` relates to. */
  targets(from: NodeId): readonly NodeId[] {
    return (this.#rows.get(from)?.array() ?? []).map((number) => this.#numbering.nodeAt(number));
  }

  /** Relates `into` to what `from` relates to, but to `into` itself. */
  addAllOf(into: NodeId, from: NodeId): void {
    const source = this.#rows.get(from);
    if (source === undefined || into === from) {
      return;
    }
    const row = this.#rowOf(into);
    const own = this.#numbering.numberOf(into);
    const had = own !== undefined && row.has(own);
    joinRow(row, source);
    if (own !== undefined && !had && row.has(own)) {
      row.remove(own);
    }
  }

  /** Relates `node` to nothing, and nothing to it. */
  delete(node: NodeId): void {
    this.#rows.delete(node);
    const number = this.#numbering.numberOf(node);
    if (number === undefined) {
      return;
    }
    for (const row of this.#rows.values()) {
      if (row.has(number)) {
        row.remove(number);
      }
    }
  }

  /** Adds every pair of `other`, a relation over the same numbering. */
  join(other: NodeRelation): void {
    for (const [node, source] of other.#rows) {
      joinRow(this.#rowOf(node), source);
    }
  }

  /** How many pairs it holds. */
  size(): number {
    let count = 0;
    for (const row of this.#rows.values()) {
      count += row.size();
    }
    return count;
  }

  #rowOf(from: NodeId): TypedFastBitSet {
    const known = this.#rows.get(from);
    if (known !== undefined) {
      return known;
    }
    const row = new TypedFastBitSet();
    this.#rows.set(from, row);
    return row;
  }
}

/** Joins `source` into `row`, which stays as wide as its highest bit needs (the banner). */
function joinRow(row: TypedFastBitSet, source: TypedFastBitSet): void {
  const widens = row.words.length < source.words.length;
  row.union(source);
  if (widens) {
    row.trim();
  }
}
