/**
 * The edges of a directed graph reachable from some of its nodes, for a graph known only by asking
 * each node for its own edges: a rule that judges a whole graph (a cycle, an expanding edge) asks
 * for the part its roots reach, never for every node of a program.
 *
 * The walk keeps its frontier on a stack of its own, so a long chain can't overflow the host's
 * stack, and visits each node once, so a cycle ends it.
 */

/**
 * The edges of `roots`, and of every node those edges lead to, each node's edges taken once.
 * `targetOf` gives the node an edge leads to, or undefined for an edge leading out of the graph,
 * whose target's own edges aren't followed.
 */
export function edgesReachedFrom<Node, Edge>(
  roots: Iterable<Node>,
  edgesOf: (node: Node) => readonly Edge[],
  targetOf: (edge: Edge) => Node | undefined,
): readonly Edge[] {
  const visited = new Set<Node>();
  const pending = [...roots];
  const edges: Edge[] = [];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (!visited.has(node)) {
      visited.add(node);
      const own = edgesOf(node);
      edges.push(...own);
      for (const edge of own) {
        const target = targetOf(edge);
        if (target !== undefined) {
          pending.push(target);
        }
      }
    }
  }
  return edges;
}
