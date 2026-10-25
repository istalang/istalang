/**
 * Which unheld disposables to dispose now (spec §7).
 *
 * An object nothing holds is an orphan. A disposable orphan is disposed only once no other
 * disposable orphan still holds it, possibly through orphans that aren't disposable, such as a
 * plain `Shared` cell: a holder's disposal sees what it holds intact (a `defer` callback reads its
 * captures, a `dispose` reads `self$`), and only then lets go of it. What a disposal lets go of
 * loses its last holder at that moment, so it is disposed in the round after.
 *
 * Orphans holding each other in a cycle are one strongly connected component: none of them is
 * held from outside it, so all of them are disposed in the same round, as spec §7 has values that
 * lose their last holder together disposed: in reverse creation order.
 *
 * An object loses its holders only when something lets go of it, or of what holds it, so every
 * orphan is reached from what was let go of: the search starts there, not from the whole heap.
 */

import { pushAll } from '../../structures/stack.ts';
import { type GraphEdge, stronglyConnected } from '../../structures/strongly-connected.ts';
import type { Heap, LiveObject } from '../scheduler/heap.ts';
import { holdsOf, walkHolds } from './holders.ts';

/** What finding the orphans to dispose starts from. */
export interface OrphanSearch {
  /** What a walk from the roots found held. */
  readonly held: ReadonlySet<number>;
  /** The objects let go of: every orphan is reached from them. */
  readonly from: Iterable<number>;
  readonly isDisposable: (object: LiveObject) => boolean;
}

/**
 * The disposable objects of `heap` to dispose now, newest first: unheld, with no other unheld
 * disposable still holding them.
 */
export function readyOrphans(heap: Heap, search: OrphanSearch): readonly number[] {
  const orphans = orphansFrom(heap, search);
  const disposable = orphans.filter(search.isDisposable).map((object) => object.id);
  if (disposable.length === 0) {
    return [];
  }
  const isOrphan = new Set(orphans.map((object) => object.id));
  const successors = new Map(
    orphans.map((object) => [object.id, holdsOf(object).filter((id) => isOrphan.has(id))]),
  );
  const covered = coveredBy(disposable, successors);
  return disposable.filter((id) => !covered.has(id)).sort((first, second) => second - first);
}

/**
 * The orphans a disposable one reaches outside its own component: held by another disposable
 * orphan, so not ready yet. A path leaves a component through some member of it, disposable or
 * not, and whatever it reaches after can't lead back in, or it would be part of the component.
 */
function coveredBy(
  disposable: readonly number[],
  successors: ReadonlyMap<number, readonly number[]>,
): ReadonlySet<number> {
  const edges: GraphEdge<number>[] = [...successors].flatMap(([from, tos]) =>
    tos.map((to) => ({ from, to })),
  );
  const componentOf = stronglyConnected(edges);
  const component = (node: number): number => componentOf(node) ?? node;
  const holding = new Set(disposable.map(component));
  const pending: number[] = [];
  for (const [node, nexts] of successors) {
    const own = component(node);
    if (holding.has(own)) {
      pushAll(
        pending,
        nexts.filter((next) => component(next) !== own),
      );
    }
  }
  const covered = new Set<number>();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!covered.has(next)) {
      covered.add(next);
      pushAll(pending, successors.get(next) ?? []);
    }
  }
  return covered;
}

/** The unheld objects reached from `search.from`: an object held holds only what is held too. */
function orphansFrom(heap: Heap, search: OrphanSearch): readonly LiveObject[] {
  const orphans: LiveObject[] = [];
  walkHolds(heap, search.from, (object) => {
    if (search.held.has(object.id) || object.kind === 'execution') {
      return 'past';
    }
    orphans.push(object);
    return 'through';
  });
  return orphans;
}
