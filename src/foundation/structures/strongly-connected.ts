/**
 * The strongly connected components of a directed graph given as its edges (Tarjan's algorithm):
 * two nodes share a component exactly when each reaches the other, which is how a rule asks
 * whether an edge lies on a cycle (its ends share a component).
 *
 * The walk keeps its path on a stack of its own, so a long chain can't overflow the host's stack:
 * the checker walks its graphs of types and declarations with it.
 */

import { addToGroup } from './groups.ts';

/** An edge of the graph, from one node to another. */
export interface GraphEdge<Node> {
  readonly from: Node;
  readonly to: Node;
}

/** Each node's component, named by one of its members; undefined for a node on no edge. */
export function stronglyConnected<Node>(
  edges: readonly GraphEdge<Node>[],
): (node: Node) => Node | undefined {
  const components = new Components(edges);
  return (node) => components.of(node);
}

class Components<Node> {
  readonly #successors = new Map<Node, Node[]>();
  readonly #order = new Map<Node, number>();
  readonly #lowest = new Map<Node, number>();
  readonly #component = new Map<Node, Node>();
  readonly #stack: Node[] = [];

  constructor(edges: readonly GraphEdge<Node>[]) {
    for (const { from, to } of edges) {
      addToGroup(this.#successors, from, to);
      this.#successors.set(to, this.#successors.get(to) ?? []);
    }
    for (const node of this.#successors.keys()) {
      if (!this.#order.has(node)) {
        this.#visit(node);
      }
    }
  }

  of(node: Node): Node | undefined {
    return this.#component.get(node);
  }

  /** Tarjan's depth-first walk from `start`, its path kept on a stack of its own. */
  #visit(start: Node): void {
    const path: { readonly node: Node; next: number }[] = [this.#enter(start)];
    for (let top = path.at(-1); top !== undefined; top = path.at(-1)) {
      const successor = this.#successors.get(top.node)?.[top.next];
      top.next += 1;
      if (successor === undefined) {
        path.pop();
        this.#leave(top.node, path.at(-1)?.node);
      } else if (!this.#order.has(successor)) {
        path.push(this.#enter(successor));
      } else if (!this.#component.has(successor)) {
        this.#lower(top.node, this.#order.get(successor) ?? 0);
      }
    }
  }

  #enter(node: Node): { readonly node: Node; next: number } {
    const position = this.#order.size;
    this.#order.set(node, position);
    this.#lowest.set(node, position);
    this.#stack.push(node);
    return { node, next: 0 };
  }

  /** Finishes `node`, closing its component if it roots one, and lowers its `parent` by it. */
  #leave(node: Node, parent: Node | undefined): void {
    if (this.#lowest.get(node) === this.#order.get(node)) {
      this.#close(node);
    }
    if (parent !== undefined && !this.#component.has(node)) {
      this.#lower(parent, this.#lowest.get(node) ?? 0);
    }
  }

  #lower(node: Node, to: number): void {
    this.#lowest.set(node, Math.min(this.#lowest.get(node) ?? to, to));
  }

  /** Pops the component rooted at `root` off the stack. */
  #close(root: Node): void {
    let member = this.#stack.pop();
    while (member !== undefined) {
      this.#component.set(member, root);
      member = member === root ? undefined : this.#stack.pop();
    }
  }
}
