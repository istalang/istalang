/**
 * Entries against their contract over random graphs of what reads what, each node answering its
 * label and its successors' answers: each answer is computed once, a key's notes are those of
 * everything it read, and a cycle's members are exactly the keys on a cycle (brute-force
 * reachability), each answering its stand-in whatever order keys were asked in. A revision made
 * from another answers as one made afresh, computing only what reaches a change or a cycle.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sameItems } from '../equality.ts';
import type { GraphEdge } from '../strongly-connected.ts';
import { Unreachable } from '../unreachable.ts';
import { Entries, type EntryTable } from './index.ts';

type Edge = GraphEdge<number>;

interface Graph {
  readonly edges: readonly Edge[];
  readonly labels: readonly string[];
}

const standIn = 'stand-in';

/** A revision over `graph`, taking over `previous`'s entries, counting the nodes it computes. */
function graphRevision(graph: Graph, previous?: Entries<string>) {
  const computed: number[] = [];
  const entries = new Entries<string>({
    previous,
    observe: (_table, node) => computed.push(node as number),
  });
  const label = entries.input({ name: 'label', read: (node: number) => graph.labels[node] });
  const successors = entries.input({
    name: 'successors',
    read: (node: number) => graph.edges.filter(({ from }) => from === node).map(({ to }) => to),
    equal: sameItems(),
  });
  const table = entries.table<number, string>({
    name: 'answers',
    compute: (node) => {
      entries.note(`node ${node}`);
      return `${label(node)}(${successors(node).map(answer).join(',')})`;
    },
    cyclic: { standIn: () => standIn, reportMember: (node) => entries.note(`member ${node}`) },
  });
  const answer = (node: number): string => table.get(node);
  return { entries, table, answer, computed };
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
const edgeLists = fc.array(fc.record({ from: fc.nat(6), to: fc.nat(6) }), { maxLength: 14 });
const labelLists = fc.array(fc.constantFrom('a', 'b'), { minLength: 7, maxLength: 7 });
const graphs = fc.record({ edges: edgeLists, labels: labelLists });
const orders = fc.shuffledSubarray(nodes, { minLength: nodes.length });
const asked = fc.subarray(nodes);

/** A graph and an edit of it: some labels changed, some edges added and removed. */
const edits = fc
  .tuple(graphs, labelLists, fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }), edgeLists)
  .map(([before, labels, relabelled, added]) => {
    const after: Graph = {
      labels: before.labels.map(
        (label, node) => (relabelled[node] ? labels[node] : label) ?? label,
      ),
      edges: [...before.edges.filter((_edge, index) => index % 3 !== 0), ...added.slice(0, 3)],
    };
    return { before, after };
  });

const notesOf = (revision: ReturnType<typeof graphRevision>, node: number) =>
  revision.table.notesFrom(node).toSorted();

/**
 * Whether a revision over `after` may compute `node` again, the revisions before it having
 * computed `held`: only if none did, or it reaches a node the edit changed or a cycle. A cycle
 * the edit makes passes through a changed node, so the graph before tells both.
 */
function mayComputeAfter(
  { before, after }: { readonly before: Graph; readonly after: Graph },
  held: ReadonlySet<number>,
) {
  const successorsIn = (graph: Graph, node: number) =>
    graph.edges.filter(({ from }) => from === node).map(({ to }) => to);
  const changed = nodes.filter(
    (node) =>
      before.labels[node] !== after.labels[node] ||
      successorsIn(before, node).join() !== successorsIn(after, node).join(),
  );
  const onCycle = (node: number) => reachedFrom(before.edges, node).has(node);
  return (node: number) =>
    !held.has(node) ||
    [node, ...reachedFrom(before.edges, node)].some(
      (each) => changed.includes(each) || onCycle(each),
    );
}

describe('entries', () => {
  it('compute each key once, in any order of asking, and answer alike', () => {
    fc.assert(
      fc.property(graphs, orders, orders, (graph, first, second) => {
        const one = graphRevision(graph);
        const other = graphRevision(graph);
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
      fc.property(graphs, orders, (graph, order) => {
        const { answer, table } = graphRevision(graph);
        for (const node of order) {
          answer(node);
        }
        const onCycle = nodes.filter((node) => reachedFrom(graph.edges, node).has(node));
        const reported = nodes.filter((node) => table.notesFrom(node).includes(`member ${node}`));
        expect(reported).toEqual(onCycle);
        expect(nodes.filter((node) => table.computed(node) === standIn)).toEqual(onCycle);
      }),
    );
  });

  it("read back a key's notes and those of everything it reached", () => {
    fc.assert(
      fc.property(graphs, (graph) => {
        const { answer, table } = graphRevision(graph);
        for (const node of nodes) {
          answer(node);
          const expected = [node, ...reachedFrom(graph.edges, node)].map((each) => `node ${each}`);
          expect(new Set(table.notesFrom(node).filter((note) => note.startsWith('node')))).toEqual(
            new Set(expected),
          );
        }
      }),
    );
  });

  it('answer in a revision made from another as in one made afresh', () => {
    fc.assert(
      fc.property(edits, asked, orders, ({ before, after }, first, order) => {
        const previous = graphRevision(before);
        for (const node of first) {
          previous.answer(node);
        }
        const revision = graphRevision(after, previous.entries);
        const fresh = graphRevision(after);
        for (const node of order) {
          expect(revision.answer(node)).toBe(fresh.answer(node));
        }
        for (const node of nodes) {
          expect(notesOf(revision, node)).toEqual(notesOf(fresh, node));
        }
      }),
    );
  });

  it('compute again only what reaches a change, a cycle, or was never asked', () => {
    fc.assert(
      fc.property(edits, asked, orders, (edit, first, order) => {
        const previous = graphRevision(edit.before);
        for (const node of first) {
          previous.answer(node);
        }
        const revision = graphRevision(edit.after, previous.entries);
        for (const node of order) {
          revision.answer(node);
        }
        const mayCompute = mayComputeAfter(edit, new Set(previous.computed));
        expect(revision.computed.filter((node) => !mayCompute(node))).toEqual([]);
      }),
    );
  });

  it('take over, through a revision that never asked for a key, what the one before it held', () => {
    fc.assert(
      fc.property(edits, asked, asked, orders, (edit, first, between, order) => {
        const previous = graphRevision(edit.before);
        for (const node of first) {
          previous.answer(node);
        }
        const middle = graphRevision(edit.after, previous.entries);
        for (const node of between) {
          middle.answer(node);
        }
        const revision = graphRevision(edit.after, middle.entries);
        const fresh = graphRevision(edit.after);
        for (const node of order) {
          expect(revision.answer(node)).toBe(fresh.answer(node));
        }
        for (const node of nodes) {
          expect(notesOf(revision, node)).toEqual(notesOf(fresh, node));
        }
        const mayCompute = mayComputeAfter(
          edit,
          new Set([...previous.computed, ...middle.computed]),
        );
        expect(revision.computed.filter((node) => !mayCompute(node))).toEqual([]);
      }),
    );
  });

  it('take an entry over when what it read computes again to an equal answer', () => {
    const revisionOver = (text: string, previous?: Entries<string>) => {
      const computed: unknown[] = [];
      const entries = new Entries<string>({
        previous,
        observe: (_table, key) => computed.push(key),
      });
      const leaf = entries.input({ name: 'leaf', read: () => text });
      const length = entries.table<'length', number>({
        name: 'length',
        compute: () => leaf().length,
      });
      const top = entries.table<'top', string>({
        name: 'top',
        compute: () => `${length.get('length')}`,
      });
      return { entries, top, computed };
    };
    const first = revisionOver('ab');
    expect(first.top.get('top')).toBe('2');
    const second = revisionOver('cd', first.entries);
    expect(second.top.get('top')).toBe('2');
    expect(second.computed).toEqual(['length']);
  });

  it('compute an entry again when the notes it read changed, though no answer did', () => {
    const revisionOver = (note: string, previous?: Entries<string>) => {
      const entries = new Entries<string>({ previous });
      const input = entries.input({ name: 'note', read: () => note });
      const noting = entries.table<'noting', number>({
        name: 'noting',
        compute: () => {
          entries.note(input());
          return 0;
        },
      });
      const reading = entries.table<'reading', string>({
        name: 'reading',
        compute: () => {
          noting.get('noting');
          return entries.notesReached().join();
        },
      });
      return { entries, reading };
    };
    const first = revisionOver('one');
    expect(first.reading.get('reading')).toBe('one');
    expect(revisionOver('two', first.entries).reading.get('reading')).toBe('two');
  });

  it('take nothing over from a revision let go of', () => {
    const graph: Graph = { edges: [{ from: 0, to: 1 }], labels: ['a', 'b'] };
    const previous = graphRevision(graph);
    previous.answer(0);
    const revision = graphRevision(graph, previous.entries);
    revision.entries.release();
    revision.answer(0);
    expect(revision.computed).toEqual([0, 1]);
  });

  it('refuse a note made outside every entry', () => {
    expect(() => new Entries<string>().note('stray')).toThrow(Unreachable);
  });

  it('refuse two tables of one name', () => {
    const entries = new Entries<string>();
    entries.table<number, number>({ name: 'twice', compute: (key) => key });
    expect(() => entries.table<number, number>({ name: 'twice', compute: (key) => key })).toThrow(
      Unreachable,
    );
  });

  it('refuse to reach an entry again while it computes when its table has no stand-in', () => {
    const entries = new Entries<string>();
    const table: EntryTable<string, number, number> = entries.table<number, number>({
      name: 'endless',
      compute: (key): number => table.get(key),
    });
    expect(() => table.get(0)).toThrow(Unreachable);
    expect(table.computed(0)).toBeUndefined();
  });

  it('answer nothing for a key never asked for', () => {
    const table = new Entries<string>().table<number, number>({
      name: 'unasked',
      compute: (key) => key,
    });
    expect(table.computed(0)).toBeUndefined();
  });
});
