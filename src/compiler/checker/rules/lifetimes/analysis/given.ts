/**
 * What a call gives (design.md §5.3): its result and what a future it gives settles with, each
 * related to the nodes the call was given as its callee's summary relates them to its inputs.
 */

import type { Input } from '../input.ts';
import type { NodeId, ReachState } from '../reach-state.ts';
import type { ResultRelation, Summary } from '../summary.ts';
import { type At, type Bound, ownedBy } from './bindings.ts';
import type { FlowState, Given, Settled } from './flow-state.ts';
import { relateByTypes } from './unseen.ts';

/**
 * The call's result, related to what it was given as the summary says; to what owns each place it
 * was given by `&`, which it may keep, as a future an async call it makes does; an async call's
 * future to what its call may come to reach; and, for a future, what it settles with.
 */
export function giveResult(
  { analysis, state }: At,
  made: { readonly into: NodeId; readonly isAsync: boolean },
  summary: Summary,
  {
    bound,
    places,
  }: { readonly bound: (input: Input) => Bound; readonly places: readonly NodeId[] },
): void {
  const { into } = made;
  if (!analysis.nodes.isRelevant(into)) {
    return;
  }
  state.reach.fresh(into);
  for (const { input, relation } of summary.result.relations) {
    for (const node of bound(input).nodes) {
      relate(state, into, { node, relation });
    }
  }
  if (summary.result.reachesItself) {
    state.reach.addReach(into, into);
  }
  for (const node of places) {
    relate(state, into, { node, relation: 'reaches' });
  }
  // An async call's frames hold what it was given while it waits, a place's owner among it.
  for (const input of made.isAsync ? summary.callReach : []) {
    const { nodes, owner } = bound(input);
    for (const node of [...nodes, ...ownedBy(owner)]) {
      relate(state, into, { node, relation: 'reaches' });
    }
  }
  if (summary.result.watched) {
    watchedResult({ analysis, state }, into);
  }
  const { gives } = summary;
  if (gives.relations.length > 0 || gives.reachesItself || gives.watched) {
    state.gives.set(into, {
      relations: gives.relations.flatMap(({ input, relation }) =>
        bound(input).nodes.map((node) => ({ node, relation })),
      ),
      reachesItself: gives.reachesItself,
      watched: gives.watched,
    });
  }
}

/** A future's value read where `settled` says what it settles with. */
export function readGiven(at: At, into: NodeId, settled: Settled): void {
  at.state.reach.fresh(into);
  for (const given of settled.relations) {
    relate(at.state, into, given);
  }
  if (settled.reachesItself) {
    at.state.reach.addReach(into, into);
  }
  if (settled.watched) {
    watchedResult(at, into);
  }
}

/** How a result relates to a node it was given, by the relation the summary names. */
const relating: Readonly<
  Record<ResultRelation['relation'], (reach: ReachState, into: NodeId, node: NodeId) => void>
> = {
  reaches: (reach, into, node) => reach.hold(into, node),
  reachedBy: (reach, into, node) => reach.readThrough(into, node),
  aliases: (reach, into, node) => reach.contain(into, node),
  shares: (reach, into, node) => reach.share(into, node),
};

/** Relates a result `into` to `node` as the callee's result relates to its input. */
function relate(state: FlowState, into: NodeId, { node, relation }: Given): void {
  if (into !== node && state.reach.isLive(node)) {
    relating[relation](state.reach, into, node);
  }
}

/**
 * `into` may be any value of a type its handles watch, anywhere: it relates to each value live
 * as the declaration graph lets their types (unseen.ts), and so does what the function returning
 * it gives its callers (`watches`).
 */
function watchedResult({ analysis, state }: At, into: NodeId): void {
  analysis.watched.add(into);
  state.reach.markEscaped(into);
  const reach = analysis.nodes.reachOf(into);
  for (const node of state.reach.live().filter((each) => each !== into)) {
    relateByTypes(state, [into, reach], [node, analysis.nodes.reachOf(node)]);
  }
}
