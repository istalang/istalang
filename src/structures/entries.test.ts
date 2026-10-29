/**
 * Entries against their contract over random graphs of what reads what: each answer is computed
 * once, a key's notes are those of everything it read, and a cycle's members are exactly the keys
 * on a cycle (brute-force reachability), each answering its stand-in whatever order keys were asked
 * in.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Entries, type EntryTable } from './entries.ts';
import type { GraphEdge } from './strongly-connected.ts';
import { Unreachable } from './unreachable.ts';

type Edge = GraphEdge<number>;

const standIn = 'stand-in';

/** A table over `edges` where each node notes itself and answers its successors' answers, listed. */
function graphTable(edges: readonly Edge[]) {
  const entries = new Entries<string>();
  const computed: number[] = [];
  const table: EntryTable<string, number, string> = entries.table({
    standIn: () => standIn,
    reportMember: (node) => entries.note(`member ${node}`),
  });
  const answer = (node: number): string =>
    table.get(node, () => {
      computed.push(node);
      entries.note(`node ${node}`);
      const successors = edges.filter(({ from }) => from === node).map(({ to }) => to);
      return `${node}(${successors.map(answer).join(',')})`;
    });
  return { table, answer, computed };
}

/** Every node `start` reaches by one edge or more. */
function reachedFrom(edges: readonly Edge[], start: number): ReadonlySet<number> {
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

const nodes = [0, 1, 2, 3, 4, 5, 6];
const graphs = fc.array(fc.record({ from: fc.nat(6), to: fc.nat(6) }), { maxLength: 14 });
const orders = fc.shuffledSubarray(nodes, { minLength: nodes.length });

describe('entries', () => {
  it('compute each key once, in any order of asking, and answer alike', () => {
    fc.assert(
      fc.property(graphs, orders, orders, (edges, first, second) => {
        const one = graphTable(edges);
        const other = graphTable(edges);
        const answers = new Map(first.map((node) => [node, one.answer(node)]));
        for (const node of second) {
          expect(other.answer(node)).toBe(answers.get(node));
        }
        expect(new Set(one.computed).size).toBe(one.computed.length);
        expect(one.computed.toSorted((a, b) => a - b)).toEqual(nodes);
      }),
    );
  });

  it('make exactly the nodes on a cycle members, each answering the stand-in', () => {
    fc.assert(
      fc.property(graphs, orders, (edges, order) => {
        const { answer, table } = graphTable(edges);
        for (const node of order) {
          answer(node);
        }
        const onCycle = nodes.filter((node) => reachedFrom(edges, node).has(node));
        const reported = nodes.filter((node) => table.notesFrom(node).includes(`member ${node}`));
        expect(reported).toEqual(onCycle);
        expect(nodes.filter((node) => table.computed(node) === standIn)).toEqual(onCycle);
      }),
    );
  });

  it("read back a key's notes and those of everything it reached", () => {
    fc.assert(
      fc.property(graphs, (edges) => {
        const { answer, table } = graphTable(edges);
        for (const node of nodes) {
          answer(node);
          const expected = [node, ...reachedFrom(edges, node)].map((each) => `node ${each}`);
          expect(new Set(table.notesFrom(node).filter((note) => note.startsWith('node')))).toEqual(
            new Set(expected),
          );
        }
      }),
    );
  });

  it('refuse a note made outside every entry', () => {
    expect(() => new Entries<string>().note('stray')).toThrow(Unreachable);
  });

  it('refuse to reach an entry again while it computes when its table has no stand-in', () => {
    const entries = new Entries<string>();
    const table = entries.table<number, number>();
    const answer = (): number => table.get(0, answer);
    expect(answer).toThrow(Unreachable);
    expect(table.computed(0)).toBeUndefined();
  });

  it('answer nothing for a key never asked for', () => {
    expect(new Entries<string>().table<number, number>().computed(0)).toBeUndefined();
  });
});
