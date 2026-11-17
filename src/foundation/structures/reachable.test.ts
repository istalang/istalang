/**
 * The nodes and edges a walk reaches against their definition: an edge is reached exactly when its source is
 * a root or the target of a reached edge leading into the graph, checked over random graphs whose
 * odd-numbered targets lead out of it. A chain of runtime size is walked without the host's stack.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { edgesReachedFrom, nodesReachedFrom } from './reachable.ts';

interface Edge {
  readonly from: number;
  readonly to: number;
}

/** Odd nodes stand outside the graph: an edge to one is reached, but its own edges aren't. */
const inGraph = (edge: Edge) => (edge.to % 2 === 0 ? edge.to : undefined);

/** The nodes `roots` reach by edges leading into the graph, by brute force over every edge. */
function graphNodesFrom(roots: readonly number[], edges: readonly Edge[]): ReadonlySet<number> {
  const nodes = new Set(roots);
  for (const _ of edges) {
    for (const edge of edges.filter(({ from }) => nodes.has(from))) {
      const target = inGraph(edge);
      if (target !== undefined) {
        nodes.add(target);
      }
    }
  }
  return nodes;
}

const graphs = fc.array(fc.record({ from: fc.nat(7), to: fc.nat(7) }), { maxLength: 20 });

describe('edgesReachedFrom', () => {
  it('reaches the edges of the roots and of every node a reached edge leads into', () => {
    fc.assert(
      fc.property(graphs, fc.uniqueArray(fc.nat(7), { maxLength: 3 }), (edges, roots) => {
        const reached = edgesReachedFrom(
          roots,
          (node) => edges.filter((edge) => edge.from === node),
          inGraph,
        );
        const nodes = graphNodesFrom(roots, edges);
        const expected = edges.filter((edge) => nodes.has(edge.from));
        expect(new Set(reached)).toEqual(new Set(expected));
        expect(reached).toHaveLength(expected.length);
      }),
    );
  });

  it('walks a long chain without the host stack', () => {
    const length = 200_000;
    const reached = edgesReachedFrom(
      [0],
      (node) => (node < length ? [{ from: node, to: node + 1 }] : []),
      (edge) => edge.to,
    );
    expect(reached).toHaveLength(length);
  });
});

describe('nodesReachedFrom', () => {
  it('reaches the roots and every node a reached node leads to', () => {
    fc.assert(
      fc.property(graphs, fc.uniqueArray(fc.nat(7), { maxLength: 3 }), (edges, roots) => {
        const next = (node: number) =>
          edges.filter((edge) => edge.from === node).flatMap((edge) => inGraph(edge) ?? []);
        expect(nodesReachedFrom(roots, next)).toEqual(graphNodesFrom(roots, edges));
      }),
    );
  });
});
