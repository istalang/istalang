/**
 * Partition refinement over a term graph (recursive-terms.ts), and the signatures it orders terms
 * by: lists of numbers, a class's rank, and strings, a leaf's key or a spelling, compared item by
 * item, numbers as numbers, so a rank renumbered in order keeps every comparison, which is what
 * makes the ranks' order canonical.
 *
 * - Only terms that aren't unions are refined. A union is the set of its members' classes, so a
 *   part leading to a union and a part leading to its one member's class read alike: a union whose
 *   members turn out one class is that class, however the graph was written.
 * - A term's signature is its own structure spelled with each part's set of classes, as its key
 *   spells it (type-keys.ts): an `any` type's constraints, a set, in one order however written.
 */

/** A signature's items: numbers compare as numbers, strings as strings. */
export type Signature = readonly (number | string)[];

/** Ranks of `terms` by their signatures: equal signatures one rank, ordered as they compare. */
function rankedBy(
  terms: readonly number[],
  signatureOf: (term: number) => Signature,
  size: number,
): number[] {
  const signed = terms.map((term) => ({ term, signature: signatureOf(term) }));
  signed.sort((first, second) => compareSignatures(first.signature, second.signature));
  const ranks = new Array<number>(size).fill(-1);
  let rank = -1;
  signed.forEach(({ term, signature }, index) => {
    const previous = signed[index - 1];
    if (previous === undefined || compareSignatures(previous.signature, signature) !== 0) {
      rank += 1;
    }
    ranks[term] = rank;
  });
  return ranks;
}

/** How many classes `ranks` puts `terms` in. */
function countOf(ranks: readonly number[], terms: readonly number[]): number {
  return new Set(terms.map((term) => ranks[term])).size;
}

/** `signatures` sorted and without repeats. */
function uniqueSorted(signatures: readonly Signature[]): readonly Signature[] {
  const sorted = [...signatures].sort(compareSignatures);
  return sorted.filter(
    (signature, index) =>
      index === 0 || compareSignatures(sorted[index - 1] ?? [], signature) !== 0,
  );
}

/** Compares two signatures item by item, numbers as numbers, then by length. */
export function compareSignatures(first: Signature, second: Signature): number {
  const index = first.findIndex((item, at) => item !== second[at]);
  if (index < 0 || index >= second.length) {
    return first.length - second.length;
  }
  return compareItems(first[index] ?? '', second[index] ?? '');
}

/** Two differing items: numbers as numbers, else as strings. */
function compareItems(first: number | string, second: number | string): number {
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  return String(first) < String(second) ? -1 : 1;
}

/** Where a term's part leads, as refinement reads it: a leaf's key, or a term. */
type PartRef =
  | { readonly kind: 'leaf'; readonly key: string }
  | { readonly kind: 'term'; readonly term: number };

/** A term graph as refinement reads it (the banner). */
interface Refinable {
  /** How many terms there are: ranks are indexed by term. */
  readonly size: number;
  /** The live terms that aren't unions. */
  readonly nodes: readonly number[];
  /** The live union terms. */
  readonly unions: readonly number[];
  /** A node's own structure spelled, each of its parts, resolved, spelled by `spellPart`. */
  readonly spelled: (node: number, spellPart: (part: PartRef) => string) => string;
  /** The members `part` stands for: a union's, resolved, else `part` itself. */
  readonly membersOf: (part: PartRef) => readonly PartRef[];
}

/**
 * Each term's rank once refining splits no class (the banner): nodes ranked first, then unions by
 * their members' classes.
 */
export function refinedRanks(graph: Refinable): number[] {
  let ranks = rankedBy(graph.nodes, (node) => [graph.spelled(node, () => '_')], graph.size);
  let classes = countOf(ranks, graph.nodes);
  for (;;) {
    const current = ranks;
    const spellPart = classesSpelled(graph, current);
    const next = rankedBy(
      graph.nodes,
      (node) => [current[node] ?? -1, graph.spelled(node, spellPart)],
      graph.size,
    );
    const count = countOf(next, graph.nodes);
    ranks = next;
    if (count === classes) {
      break;
    }
    classes = count;
  }
  const spellUnion = classesSpelled(graph, ranks);
  const unionRanks = rankedBy(
    graph.unions,
    (union) => [spellUnion({ kind: 'term', term: union })],
    graph.size,
  );
  for (const union of graph.unions) {
    ranks[union] = classes + (unionRanks[union] ?? 0);
  }
  return ranks;
}

/** Spells a part as the set of classes, by `ranks`, of the members it stands for. */
function classesSpelled(graph: Refinable, ranks: readonly number[]): (part: PartRef) => string {
  return (part) =>
    JSON.stringify(
      uniqueSorted(
        graph
          .membersOf(part)
          .map(
            (member): Signature =>
              member.kind === 'leaf' ? [0, member.key] : [1, ranks[member.term] ?? -1],
          ),
      ),
    );
}
