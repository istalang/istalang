/**
 * What a call gives (design.md §5.3): its result and what a future it gives settles with, each
 * related to the nodes the call was given as its callee's summary relates them to its inputs.
 *
 * - **A default** a call leaves out gives a value of the call's own, related to what the call bound
 *   before it as the default's value relates to the parameters before it, and ended with the call.
 * - **What a watching handle may give** (`deref`) is any value of a type it watches, anywhere: the
 *   function's own node for it relates to nothing, so its callers see only what came to hold such
 *   a value, and each use makes a value of it relating to each value live as the declaration
 *   graph lets their types (`watchedValue`), ended after that use.
 */

import type { Operation } from '../../../surface/flow-ir.ts';
import { type Input, inputKey } from '../input.ts';
import type { NodeId, ReachState } from '../reach-state.ts';
import type { GivenValue, ResultRelation, Summary } from '../summary.ts';
import { anyReach } from '../type-reach.ts';
import { type At, type Bindings, type Bound, boundIn, ownedBy } from './bindings.ts';
import type { Given, Settled } from './flow-state.ts';
import { relateByTypes } from './unseen.ts';

type CallOperation = Extract<Operation, { readonly op: 'call' }>;

/**
 * The call's result, related to what it was given as the summary says; to what owns each place it
 * was given by `&`, which it may keep, as a future an async call it makes does; an async call's
 * future to what its call may come to reach; and, for a future, what it settles with.
 */
export function giveResult(
  at: At,
  made: { readonly into: NodeId; readonly isAsync: boolean },
  summary: Summary,
  {
    bound,
    places,
  }: { readonly bound: (input: Input) => Bound; readonly places: readonly NodeId[] },
): void {
  const { into } = made;
  const { analysis, state } = at;
  if (!analysis.nodes.isRelevant(into)) {
    return;
  }
  const bind = (value: GivenValue): Settled => ({
    relations: value.relations.flatMap(({ input, relation }) =>
      bound(input).nodes.map((node) => ({ node, relation })),
    ),
    reachesItself: value.reachesItself,
  });
  giveValue(at, into, bind(summary.result));
  for (const node of places) {
    relate(at, into, { node, relation: 'reaches' });
  }
  // An async call's frames hold what it was given while it waits, a place's owner among it.
  for (const input of made.isAsync ? summary.callReach : []) {
    const { nodes, owner } = bound(input);
    for (const node of [...nodes, ...ownedBy(owner)]) {
      relate(at, into, { node, relation: 'reaches' });
    }
  }
  const { gives } = summary;
  if (gives.relations.length > 0 || gives.reachesItself) {
    state.gives.set(into, bind(gives));
  }
}

/**
 * `bindings`, with each parameter `operation`'s call leaves to its default bound to a value of the
 * call's own (`Nodes.defaultOf`), in parameter order, so a default may relate to one before it.
 */
export function withDefaults(at: At, operation: CallOperation, bindings: Bindings): Bindings {
  const { analysis } = at;
  const { call } = operation;
  const all = new Map(bindings);
  call.binding.forEach((source, index) => {
    if (source.kind !== 'default') {
      return;
    }
    const value = analysis.context.defaultResult(call.function, index);
    const type = analysis.context.parametersOf(call.function)[index]?.type;
    const node = analysis.nodes.defaultOf(operation, index, type);
    giveValue(at, node, {
      relations: value.relations.flatMap(({ input, relation }) =>
        boundIn(at, all, input).nodes.map((each) => ({ node: each, relation })),
      ),
      reachesItself: value.reachesItself,
    });
    all.set(inputKey({ kind: 'parameter', index }), { nodes: [node], owner: undefined });
  });
  return all;
}

/** `into` given afresh as `settled` says: a call's result, a future's value, a default's. */
export function giveValue(at: At, into: NodeId, settled: Settled): void {
  at.state.reach.fresh(into);
  for (const given of settled.relations) {
    relate(at, into, given);
  }
  if (settled.reachesItself) {
    at.state.reach.addReach(into, into);
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
function relate(at: At, into: NodeId, { node, relation }: Given): void {
  const { state } = at;
  if (into === node || !state.reach.isLive(node)) {
    return;
  }
  // `into` is given afresh: it may neither reach nor be reached by what a watching handle gives.
  withWatched(at, node, (value) => relating[relation](state.reach, into, value), into);
}

/**
 * Runs `use` on `node`, or, where it is what a watching handle may give, on a value of it made for
 * that use alone: escaped, relating to each value live but `fresh` as the declaration graph lets
 * their types (unseen.ts), and one with the function's own node for it, so what comes to hold it
 * holds that.
 */
export function withWatched(
  at: At,
  node: NodeId,
  use: (value: NodeId) => void,
  fresh?: NodeId,
): void {
  const { analysis, state } = at;
  if (!analysis.nodes.isWatched(node)) {
    use(node);
    return;
  }
  const value = analysis.nodes.watchedValue();
  state.reach.fresh(value);
  state.reach.markEscaped(value);
  const related = state.reach.live().filter((live) => ![value, node, fresh].includes(live));
  for (const each of related) {
    relateByTypes(state, [value, anyReach], [each, analysis.nodes.reachOf(each)]);
  }
  state.reach.addAlias(value, node);
  use(value);
  state.reach.kill(value);
}
