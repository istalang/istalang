/**
 * A function's analysis summed up over its inputs (design.md §5.3): what the functions calling it
 * apply instead of its body (../summary.ts), one projection of its states onto what a summary
 * names.
 *
 * - **What a summary names** are its inputs and the parts of them it read (inputs.ts), each standing
 *   for itself: a pair of them related as the function ends that weren't as it started is an
 *   effect, two parts of one input among them, and one that comes to reach itself is an effect on
 *   itself: a value whose parts reach each other.
 * - **What a call gives,** its result and what its future settles with, relates to those, and may
 *   reach itself too: a tuple of a handle and what it holds.
 * - **Where its callers see it:** where it returns, and for an async function also where it waits
 *   or stops, since its caller runs on from its first wait with what it did so far.
 */

import type { ValueId } from '../../../surface/flow-ir.ts';
import { type Input, inputKey, sameInput } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import {
  type Effect,
  type GivenValue,
  type ResultRelation,
  type Summary,
  summaryOf,
} from '../summary.ts';
import type { BodyAnalysis } from './body.ts';
import { type FlowState, type Given, joinedStates } from './flow-state.ts';
import { apart, type Candidate, candidatesIn } from './inputs.ts';
import type { InputSlot } from './nodes.ts';

/** A state where the function returns, and the value it returns there. */
export interface Return {
  readonly state: FlowState;
  readonly value: ValueId | undefined;
}

/** The states a function's callers see: where it returns, and where an async one waits or stops. */
export interface Ends {
  readonly returns: readonly Return[];
  readonly seen: readonly FlowState[];
}

/** What the function does over its inputs, read off where its callers see it. */
export function summarize(
  analysis: BodyAnalysis,
  entry: FlowState,
  ends: Ends,
  isAsync: boolean,
): Summary {
  const { nodes } = analysis;
  const slots = nodes.inputs.filter((slot) => nodes.isRelevant(slot.node));
  const { result, gives } = resultsOf(analysis, ends.returns, slots, isAsync);
  return summaryOf({
    effects: effectsOf(analysis, entry, [...ends.returns.map(({ state }) => state), ...ends.seen]),
    result,
    gives,
    requirements: [...analysis.requirements.values()],
    always: [...analysis.always.values()],
    callReach: isAsync ? callReachOf(slots, ends.seen) : [],
    leaks: [...analysis.leaks.values()],
    unseen: analysis.unseen,
    calls: [...analysis.calls.values()],
    access: [...analysis.access.values()],
    conversions: [...analysis.conversions.values()],
  });
}

/**
 * What an async call's future may come to reach: every input its frames hold at a wait, which,
 * since parameters live until the function ends, is every input; what a watching handle gave it
 * where something held it as it waited.
 */
function callReachOf(slots: readonly InputSlot[], seen: readonly FlowState[]): readonly Input[] {
  const heldAtWait = (node: NodeId) =>
    seen.some((state) =>
      state.reach
        .live()
        .some(
          (each) =>
            each !== node && (state.reach.reaches(each, node) || state.reach.aliases(each, node)),
        ),
    );
  return slots
    .filter((slot) => slot.input.kind !== 'watched' || heldAtWait(slot.node))
    .map(({ input }) => input);
}

/**
 * The pairs of what the summary names that `states` relate and the function's start didn't: each
 * input and part of one reaching another on a branch of its own, or itself. An input reaching
 * itself through parts whose effects name them says no more than those: only one whose parts it
 * didn't read, or names whole (a recursive group's), comes to reach itself as a whole.
 */
function effectsOf(
  analysis: BodyAnalysis,
  entry: FlowState,
  states: readonly FlowState[],
): readonly Effect[] {
  if (states.length === 0) {
    return [];
  }
  const joined = joinedStates(analysis.nodes, states);
  const named = candidatesIn(analysis, joined);
  const rootNodes = new Map(
    analysis.nodes.inputs.map((slot) => [inputKey(slot.input), analysis.inputNodeOf(slot)]),
  );
  const rootOf = (input: Input): NodeId | undefined =>
    input.kind === 'path' ? rootOf(input.of) : rootNodes.get(inputKey(input));
  const effects = new Map<string, Effect>();
  for (const from of named) {
    for (const to of named) {
      const effect = effectOf(analysis, { entry, joined }, { from, to }, rootOf);
      if (effect !== undefined) {
        effects.set(`${inputKey(from.input)}>${inputKey(to.input)}:${effect.inside}`, effect);
      }
    }
  }
  const relatedWithin = new Set(
    [...effects.values()].flatMap(({ from, to }) =>
      from.kind === 'path' && rootOf(from) === rootOf(to) ? [rootOf(from)] : [],
    ),
  );
  return [...effects.values()].filter(
    ({ from, to }) =>
      !(from.kind !== 'path' && sameInput(from, to) && relatedWithin.has(rootOf(from))),
  );
}

/** What `from` came to reach of `to` by `joined` that it didn't at `entry`, if anything. */
function effectOf(
  analysis: BodyAnalysis,
  { entry, joined }: { readonly entry: FlowState; readonly joined: FlowState },
  { from, to }: { readonly from: Candidate; readonly to: Candidate },
  rootOf: (input: Input) => NodeId | undefined,
): Effect | undefined {
  if (from.node === to.node) {
    // No input reaches itself as given: one that does now holds parts reaching each other.
    return joined.reach.reaches(from.node, from.node)
      ? { from: from.input, to: from.input, inside: false }
      : undefined;
  }
  // Parts of one input start apart; inputs related as given relate their parts as given too.
  const [fromRoot, toRoot] = [rootOf(from.input), rootOf(to.input)];
  if (
    !apart(from.input, to.input) ||
    (fromRoot !== undefined &&
      toRoot !== undefined &&
      fromRoot !== toRoot &&
      related(entry, fromRoot, toRoot))
  ) {
    return undefined;
  }
  // A reference parameter is its caller's place: a value it holds that may be `to` holds `to`.
  const holds = analysis.references.has(from.node) && joined.reach.aliases(from.node, to.node);
  if (holds || joined.reach.reaches(from.node, to.node)) {
    return { from: from.input, to: to.input, inside: false };
  }
  // `from` comes to reach what `to` holds: something read out of it, or sharing with it.
  return joined.reach.reachedFrom(from.node).some((node) => joined.reach.carriedBy(node, to.node))
    ? { from: from.input, to: to.input, inside: true }
    : undefined;
}

/**
 * How what the function returns relates to its inputs, and whether it reaches itself: a plain
 * function's result, and what a future it returns settles with; an async function's result is
 * what its future settles with.
 */
function resultsOf(
  analysis: BodyAnalysis,
  exits: readonly Return[],
  slots: readonly InputSlot[],
  isAsync: boolean,
): { readonly result: GivenValue; readonly gives: GivenValue } {
  const result = new Map<string, ResultRelation>();
  const gives = new Map<string, ResultRelation>();
  const returned = exits.filter(
    (exit): exit is Return & { readonly value: ValueId } =>
      exit.value !== undefined && exit.state.reach.isLive(exit.value),
  );
  for (const { state, value } of returned) {
    for (const slot of slots) {
      const node = analysis.inputNodeOf(slot);
      const given = isAsync ? [] : (state.gives.get(value)?.relations ?? []);
      const relations = [
        ...resultRelations(state, value, node).map(
          (relation) => [isAsync ? gives : result, relation] as const,
        ),
        ...given.flatMap((each) =>
          givenRelations(state, each, node).map((relation) => [gives, relation] as const),
        ),
      ];
      for (const [into, relation] of relations) {
        into.set(`${inputKey(slot.input)}:${relation}`, { input: slot.input, relation });
      }
    }
  }
  const selfReaching = returned.some(({ state, value }) => state.reach.reaches(value, value));
  const settlesSelfReaching = returned.some(
    ({ state, value }) => state.gives.get(value)?.reachesItself === true,
  );
  return {
    result: { relations: [...result.values()], reachesItself: !isAsync && selfReaching },
    gives: {
      relations: [...gives.values()],
      reachesItself: isAsync ? selfReaching : settlesSelfReaching,
    },
  };
}

function related(state: FlowState, first: NodeId, second: NodeId): boolean {
  return state.reach.reaches(first, second) || state.reach.shares(first, second);
}

/**
 * How a future's value relates to the input `node`, from how it relates to `given.node`: as that
 * node does, where it is the input or one with it, or within what the input reaches.
 */
function givenRelations(
  state: FlowState,
  given: Given,
  node: NodeId,
): readonly ResultRelation['relation'][] {
  if (given.node === node || state.reach.aliases(given.node, node)) {
    return [given.relation];
  }
  if (state.reach.reaches(node, given.node)) {
    return ['reachedBy'];
  }
  if (state.reach.reaches(given.node, node)) {
    return given.relation === 'reachedBy' ? ['shares'] : ['reaches'];
  }
  return state.reach.shares(given.node, node) ? ['shares'] : [];
}

/** How the result `value` relates to the input `node`: each relation that may hold. */
function resultRelations(
  state: FlowState,
  value: ValueId,
  node: NodeId,
): readonly ResultRelation['relation'][] {
  const relations: ResultRelation['relation'][] = [];
  if (state.reach.aliases(value, node)) {
    relations.push('aliases');
  }
  if (state.reach.reaches(value, node)) {
    relations.push('reaches');
  }
  if (state.reach.reaches(node, value)) {
    relations.push('reachedBy');
  }
  if (relations.length === 0 && state.reach.shares(value, node)) {
    relations.push('shares');
  }
  return relations;
}
