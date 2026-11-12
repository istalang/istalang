/**
 * The analysis's state at a point (design.md §5.2): the reach relations (../reach-state.ts), which
 * temporaries name a variable's or a path's value, so a read through them names that path, and
 * which nodes hold a function the body can tell the calls of (`KnownFunction`), and which hold a
 * future whose value is known apart from what the future holds (`Given`).
 *
 * Paths join where they meet. A path read on one side only is read on the others too, as the
 * read would have found it there, so a part read in a loop's pass and again after the loop stays
 * one value (`materialize`); one whose root isn't there is left out.
 */

import type { FlowFunction, ValueId } from '../../flow/flow-ir.ts';
import type { NodeId, ReachState } from '../reach-state.ts';
import type { ResultRelation, Summary } from '../summary.ts';
import { isInputRooted } from './inputs.ts';
import type { Nodes } from './nodes.ts';

/** A closure this body made: its function, what it does, and the nodes it captured. */
export interface MadeClosure {
  readonly kind: 'closure';
  readonly flow: FlowFunction;
  readonly summary: Summary;
  readonly parts: readonly NodeId[];
  readonly isAsync: boolean;
}

/**
 * A function value whose calls the body can tell: a closure it made, or a cursor a native
 * `iterate` gives, which holds what it iterates, each of its calls giving an item of that.
 */
type KnownFunction = MadeClosure | { readonly kind: 'items' };

/** How a value relates to a node: a call's result to what it was given. */
export interface Given {
  readonly node: NodeId;
  readonly relation: ResultRelation['relation'];
}

/** What a future settles with, as a summary's `GivenValue` says, its inputs bound to nodes. */
export interface Settled {
  readonly relations: readonly Given[];
  readonly reachesItself: boolean;
  readonly watched: boolean;
}

export interface FlowState {
  readonly reach: ReachState;
  readonly canon: Map<ValueId, NodeId>;
  readonly callees: Map<NodeId, KnownFunction>;
  /** The futures whose value is known apart from what they hold. */
  readonly gives: Map<NodeId, Settled>;
}

export function clonedState(state: FlowState): FlowState {
  return {
    reach: state.reach.clone(),
    canon: new Map(state.canon),
    callees: new Map(state.callees),
    gives: new Map(state.gives),
  };
}

/**
 * Reads the path `node` names into `state`, as reading it there would (`readThrough`,
 * `readPart`); a part of an input apart from its other parts, whose sharing its caller is required
 * to see to where a finding relies on it (inputs.ts). Where findings name inputs whole, in a
 * recursive group, no caller is required anything of its parts, so they stay related through it.
 */
export function materialize(nodes: Nodes, state: FlowState, node: NodeId): boolean {
  const path = nodes.pathOf(node);
  if (path === undefined) {
    return false;
  }
  if (!(state.reach.isLive(path.root) || materialize(nodes, state, path.root))) {
    return false;
  }
  state.reach.fresh(node);
  const siblings =
    nodes.inputParts && isInputRooted(nodes, path.root)
      ? siblingsOf(nodes, state, node)
      : undefined;
  if (path.kind === 'through') {
    state.reach.readThrough(node, path.root, siblings);
  } else {
    state.reach.readPart(node, path.root, siblings);
  }
  return true;
}

/**
 * What a part of an input is apart from: its root's other parts, the parts read of those, and
 * every value standing for one of them (`canon`), as a copy of a sibling does. A copy of the root
 * itself stays related: it holds the part.
 */
function siblingsOf(nodes: Nodes, state: FlowState, node: NodeId): ReadonlySet<NodeId> {
  const root = nodes.pathOf(node)?.root;
  const apart = new Set<NodeId>();
  const pending = root === undefined ? [] : nodes.pathsFrom(root).filter((each) => each !== node);
  while (pending.length > 0) {
    const each = pending.pop() as NodeId;
    if (!apart.has(each)) {
      apart.add(each);
      pending.push(...nodes.pathsFrom(each));
    }
  }
  for (const [value, named] of state.canon) {
    if (apart.has(named)) {
      apart.add(value);
    }
  }
  return apart;
}

/** What reaches a point where `states` meet. */
export function joinedStates(nodes: Nodes, states: readonly FlowState[]): FlowState {
  const paths = new Set(states.flatMap((state) => livePaths(nodes, state)));
  const completed = states.map((state) => {
    const missing = [...paths].filter((node) => !state.reach.isLive(node));
    if (missing.length === 0) {
      return state;
    }
    const copy = clonedState(state);
    for (const node of missing) {
      materialize(nodes, copy, node);
    }
    return copy;
  });
  const [first, ...rest] = completed as [FlowState, ...FlowState[]];
  const joined = clonedState(first);
  for (const other of rest) {
    joined.reach.join(other.reach);
    keepAgreeing(joined.canon, other.canon, Object.is);
    keepAgreeing(joined.callees, other.callees, sameKnown);
    keepAgreeing(joined.gives, other.gives, sameSettled);
  }
  return joined;
}

function livePaths(nodes: Nodes, state: FlowState): readonly NodeId[] {
  return nodes.allPaths().filter((node) => state.reach.isLive(node));
}

/** Keeps in `into` only what `other` says alike. */
function keepAgreeing<Key, Value>(
  into: Map<Key, Value>,
  other: ReadonlyMap<Key, Value>,
  same: (first: Value, second: Value) => boolean,
): void {
  for (const [key, value] of into) {
    const found = other.get(key);
    if (found === undefined || !same(value, found)) {
      into.delete(key);
    }
  }
}

function sameSettled(first: Settled, second: Settled): boolean {
  return (
    first.watched === second.watched &&
    first.reachesItself === second.reachesItself &&
    first.relations.length === second.relations.length &&
    first.relations.every(
      (each, index) =>
        each.node === second.relations[index]?.node &&
        each.relation === second.relations[index]?.relation,
    )
  );
}

/** Whether two known functions are one: one closure made, or the items of one value. */
function sameKnown(first: KnownFunction, second: KnownFunction): boolean {
  if (first.kind === 'closure') {
    return second.kind === 'closure' && first.flow === second.flow;
  }
  return second.kind === 'items';
}
