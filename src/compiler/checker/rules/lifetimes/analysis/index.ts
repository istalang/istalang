/**
 * The lifetime analysis of one flow function (design.md §5): run forward to its fixed point from
 * its inputs, unrelated and reachable from its callers, then once more to make its findings, and
 * summed up over its inputs for the functions calling it.
 *
 * - **Its inputs start unrelated,** so anything that relates two of them by the time it returns is
 *   an effect of the call, and what its result relates to is how the call's result relates to its
 *   arguments. A reference parameter is its caller's place itself, so what it comes to hold is read
 *   off the variable, not the value it was given.
 * - **An async call's future** may come to reach every input its frames hold at an `await`, which,
 *   since parameters live until the function ends, is every input (design.md §5.3).
 * - **A nested function** is analysed once, as a function of its own, its findings joining this
 *   one's: it is in this function's text.
 */

import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { Lambda } from '../../../../syntax/expressions/index.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowFunction, ValueId } from '../../flow/flow-ir.ts';
import { type ForwardRule, runForward } from '../../flow/solve.ts';
import { ReachState } from '../reach-state.ts';
import { anyField, type Effect, inputKey, type ResultRelation, type Summary } from '../summary.ts';
import { type AnalysisContext, BodyAnalysis, type Violation } from './body.ts';
import { clonedState, type FlowState, type Given, joinedStates } from './flow-state.ts';
import { type InputSlot, Nodes } from './nodes.ts';
import { runOperation } from './operations.ts';

export interface Analysis {
  readonly summary: Summary;
  readonly violations: readonly Violation[];
  /** Its inputs' types, by `inputKey`. */
  readonly inputTypes: ReadonlyMap<string, Type>;
}

export interface AnalyzeOptions {
  readonly isAsync: boolean;
  /** The parameters taken by `&`. */
  readonly references: ReadonlySet<ValueId>;
}

/** Analyses `flow`, reading what it calls through `context`. */
export function analyze(
  context: AnalysisContext,
  flow: FlowFunction,
  options: AnalyzeOptions,
): Analysis {
  const nodes = new Nodes(flow, context.facts);
  const nested = new Map<FlowFunction, Analysis & { readonly isAsync: boolean }>();
  const analysis = new BodyAnalysis(nodes, context, options.references, (inner, site) => {
    const known = nested.get(inner);
    if (known !== undefined) {
      return known;
    }
    const isAsync = isAsyncSite(site);
    const found = {
      ...analyze(context, inner, { isAsync, references: new Set() }),
      isAsync,
    };
    nested.set(inner, found);
    return found;
  });
  const rule: ForwardRule<FlowState> = {
    join: (states) => joinedStates(nodes, states),
    settled: (earlier, later) =>
      later.reach.size() === earlier.reach.size() &&
      later.canon.size === earlier.canon.size &&
      later.callees.size === earlier.callees.size &&
      later.gives.size === earlier.gives.size,
    operation: (operation, state) => {
      runOperation(analysis, state, operation);
      return state;
    },
    enter: clonedState,
  };
  const entry = entryState(analysis);
  const reaching = runForward(flow, rule, entry);
  analysis.record();
  const exits: Exit[] = [];
  flow.blocks.forEach((block, index) => {
    const start = reaching[index];
    if (start === undefined) {
      return;
    }
    const state = clonedState(start);
    for (const operation of block.operations) {
      runOperation(analysis, state, operation);
    }
    if (block.exit.kind === 'return') {
      exits.push({ state, value: block.exit.value });
    }
  });
  const nestedViolations = [...nested.values()].flatMap(({ violations }) => violations);
  return {
    summary: summarize(analysis, entry, exits, options.isAsync),
    violations: [
      ...[...analysis.violations.values()].flatMap((at) => [...at.values()]),
      ...nestedViolations,
    ],
    inputTypes: new Map(nodes.inputs.map((slot) => [inputKey(slot.input), slot.type])),
  };
}

interface Exit {
  readonly state: FlowState;
  readonly value: ValueId | undefined;
}

function isAsyncSite(site: NodeOf<string>): boolean {
  if (site.kind === 'Lambda' || site.kind === 'FunctionDeclaration') {
    return (site as Lambda | FunctionDeclaration).qualifiers.async !== undefined;
  }
  return false;
}

/**
 * The state the function starts in: each input as given, reachable from its callers, related to
 * nothing but what holds it (a cell its value, its own closure what it captured), and each
 * variable that starts as one a copy of it.
 */
function entryState(analysis: BodyAnalysis): FlowState {
  const { nodes } = analysis;
  const reach = new ReachState();
  const relevant = nodes.inputs.filter((slot) => nodes.isRelevant(slot.node));
  for (const slot of relevant) {
    reach.fresh(slot.node);
    reach.markEscaped(slot.node);
  }
  for (const slot of relevant) {
    if (slot.input.kind === 'cell') {
      const { index } = slot.input;
      const content = relevant.find(
        ({ input }) => input.kind === 'capture' && input.index === index,
      );
      if (content !== undefined) {
        reach.hold(slot.node, content.node);
      }
    } else {
      reach.copy(slot.value, slot.node);
    }
  }
  const own = relevant.find(({ input }) => input.kind === 'self');
  if (own !== undefined) {
    for (const slot of relevant) {
      if (slot.input.kind === 'cell' || slot.input.kind === 'capture') {
        reach.hold(own.node, slot.node);
      }
    }
  }
  return { reach, canon: new Map(), callees: new Map(), gives: new Map() };
}

/** What the function does over its inputs, read off where it returns. */
function summarize(
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
    watched: false,
    requirements: [...analysis.requirements.values()],
    always: [...analysis.always.values()],
    callReach: isAsync ? slots.map(({ input }) => input) : [],
    leaks: [...analysis.leaks.values()],
    unseen: analysis.unseen,
    calls: [...analysis.calls.values()],
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
    if (joined.reach.reaches(fromNode, toNode)) {
      return [{ from: from.input, to: to.input, inside: false, label: anyField }];
    }
    return joined.reach.shares(fromNode, toNode)
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
