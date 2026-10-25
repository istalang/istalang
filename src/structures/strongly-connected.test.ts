/**
 * Strongly connected components against their definition: two nodes share a component exactly
 * when each reaches the other, checked over random graphs by brute-force reachability.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type GraphEdge, stronglyConnected } from './strongly-connected.ts';

/** Every node `start` reaches by one edge or more. */
function reachedFrom(edges: readonly GraphEdge<number>[], start: number): ReadonlySet<number> {
  const reached = new Set<number>();
  const pending = [start];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const edge of edges.filter(({ from }) => from === node)) {
      if (!reached.has(edge.to)) {
        reached.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  return reached;
}

const graphs = fc.array(fc.record({ from: fc.nat(7), to: fc.nat(7) }), { maxLength: 20 });

describe('strongly connected components', () => {
  it('put two nodes on edges together exactly when each reaches the other', () => {
    fc.assert(
      fc.property(graphs, (edges) => {
        const componentOf = stronglyConnected(edges);
        const nodes = [...new Set(edges.flatMap(({ from, to }) => [from, to]))];
        for (const first of nodes) {
          for (const second of nodes) {
            const mutual =
              first === second ||
              (reachedFrom(edges, first).has(second) && reachedFrom(edges, second).has(first));
            expect(componentOf(first) === componentOf(second)).toBe(mutual);
          }
        }
      }),
    );
  });

  it('name the component of every node on an edge, and of no other', () => {
    fc.assert(
      fc.property(graphs, fc.nat(9), (edges, node) => {
        const onEdge = edges.some(({ from, to }) => from === node || to === node);
        expect(stronglyConnected(edges)(node) !== undefined).toBe(onEdge);
      }),
    );
  });
});
