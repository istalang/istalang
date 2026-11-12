/**
 * A function's analysis summed up over its inputs (design.md §5.3), read off the states where it
 * returns: what the functions calling it apply instead of its body (../summary.ts).
 */

import type { ValueId } from '../../flow/flow-ir.ts';
import { inputKey } from '../input.ts';
import { anyField, type Effect, type ResultRelation, type Summary } from '../summary.ts';
import type { BodyAnalysis } from './body.ts';
import { type FlowState, type Given, joinedStates } from './flow-state.ts';
import type { InputSlot } from './nodes.ts';

/** A state where the function returns, and the value it returns there. */
export interface Exit {
  readonly state: FlowState;
  readonly value: ValueId | undefined;
}

/** What the function does over its inputs, read off where it returns. */
export function summarize(
  analysis: BodyAnalysis,
  entry: FlowState,
  exits: readonly Exit[],
  isAsync: boolean,
): Summary {
  const { nodes } = analysis;
  const slots = nodes.inputs.filter((slot) => nodes.isRelevant(slot.node));
  const { result, gives } = resultsOf(analysis, exits, slots, isAsync);
  return {
    effects: effectsOf(analysis, entry, exits, slots),
    result,
    gives,
    // What it returns may be what a watching handle gave it, which may be any value anywhere.
    watched:
      analysis.watched.size > 0 &&
      exits.some(({ value }) => value !== undefined && nodes.isRelevant(value)),
    requirements: [...analysis.requirements.values()],
    always: [...analysis.always.values()],
    callReach: isAsync ? slots.map(({ input }) => input) : [],
    leaks: [...analysis.leaks.values()],
    unseen: analysis.unseen,
    calls: [...analysis.calls.values()],
    access: [...analysis.access.values()],
  };
}

/** The pairs of inputs related where the function returns that weren't as it started. */
function effectsOf(
  analysis: BodyAnalysis,
  entry: FlowState,
  exits: readonly Exit[],
  slots: readonly InputSlot[],
): readonly Effect[] {
  if (exits.length === 0) {
    return [];
  }
  const joined = joinedStates(
    analysis.nodes,
    exits.map(({ state }) => state),
  );
  const pairs = slots.flatMap((from) =>
    slots
      .filter((to) => from !== to && !related(entry, from.node, to.node))
      .map((to) => [from, to] as const),
  );
  return pairs.flatMap(([from, to]): Effect[] => {
    const fromNode = analysis.inputNodeOf(from);
    const toNode = analysis.inputNodeOf(to);
    // A reference parameter is its caller's place: a value it holds that may be `to` holds `to`.
    const holds = analysis.references.has(from.value) && joined.reach.aliases(fromNode, toNode);
    if (holds || joined.reach.reaches(fromNode, toNode)) {
      return [{ from: from.input, to: to.input, inside: false, label: anyField }];
    }
    // `from` comes to reach what `to` holds: something read out of it, or sharing with it.
    return joined.reach.reachedFrom(fromNode).some((node) => joined.reach.carriedBy(node, toNode))
      ? [{ from: from.input, to: to.input, inside: true, label: anyField }]
      : [];
  });
}

/**
 * How what the function returns relates to its inputs: a plain function's result, and what a
 * future it returns settles with; an async function's result is what its future settles with.
 */
function resultsOf(
  analysis: BodyAnalysis,
  exits: readonly Exit[],
  slots: readonly InputSlot[],
  isAsync: boolean,
): { readonly result: readonly ResultRelation[]; readonly gives: readonly ResultRelation[] } {
  const result = new Map<string, ResultRelation>();
  const gives = new Map<string, ResultRelation>();
  const returned = exits.filter(
    (exit): exit is Exit & { readonly value: ValueId } =>
      exit.value !== undefined && exit.state.reach.isLive(exit.value),
  );
  for (const { state, value } of returned) {
    for (const slot of slots) {
      const node = analysis.inputNodeOf(slot);
      const given = isAsync ? [] : (state.gives.get(value) ?? []);
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
  return { result: [...result.values()], gives: [...gives.values()] };
}

function related(state: FlowState, first: number, second: number): boolean {
  return state.reach.reaches(first, second) || state.reach.shares(first, second);
}

/**
 * How a future's value relates to the input `node`, from how it relates to `given.node`: as that
 * node does, where it is the input or one with it, or within what the input reaches.
 */
function givenRelations(
  state: FlowState,
  given: Given,
  node: number,
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
  node: number,
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
