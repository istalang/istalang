/**
 * The number of each node of one analysis, in the order the analysis first relates it: the bit a
 * node has in every row of every state of that analysis (node-relation.ts), so the states' rows
 * join word by word.
 */

import type { NodeId } from './reach-state.ts';

export class NodeNumbering {
  readonly #numbers = new Map<NodeId, number>();
  readonly #nodes: NodeId[] = [];

  numberOf(node: NodeId): number | undefined {
    return this.#numbers.get(node);
  }

  /** `node`'s number, given it now if it has none. */
  number(node: NodeId): number {
    const known = this.#numbers.get(node);
    if (known !== undefined) {
      return known;
    }
    this.#numbers.set(node, this.#nodes.length);
    this.#nodes.push(node);
    return this.#nodes.length - 1;
  }

  nodeAt(number: number): NodeId {
    return this.#nodes[number] as NodeId;
  }
}
