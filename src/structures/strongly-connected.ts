/**
 * The strongly connected components of a directed graph given as its edges (Tarjan's algorithm):
 * two nodes share a component exactly when each reaches the other, which is how a rule asks
 * whether an edge lies on a cycle (its ends share a component).
 *
 * The walk recurses once per node along a path, which suits the small graphs the checker builds
 * (one node per type parameter); a graph of runtime size would need it iterative.
 */

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
      this.#successors.set(from, [...(this.#successors.get(from) ?? []), to]);
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

  #visit(node: Node): void {
    const position = this.#order.size;
    this.#order.set(node, position);
    this.#lowest.set(node, position);
    this.#stack.push(node);
    for (const next of this.#successors.get(node) ?? []) {
      if (!this.#order.has(next)) {
        this.#visit(next);
      }
      if (!this.#component.has(next)) {
        this.#lower(node, this.#lowest.get(next) ?? position);
      }
    }
    if (this.#lowest.get(node) === position) {
      this.#close(node);
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
