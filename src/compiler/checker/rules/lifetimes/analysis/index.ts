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
 * - **A function holding nothing that may reach a disposable** relates nothing, so one pass finds
 *   what the fixed point would: its calls' cycles and unseen code. Most of a test suite's closures
 *   are such, and an edit inside one analyses its whole suite again.
 */

import { memo } from '../../../../../foundation/structures/memo.ts';
import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { Lambda } from '../../../../syntax/expressions/index.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowBlock, FlowFunction, ValueId } from '../../flow/flow-ir.ts';
import { type ForwardRule, reachedBlocks, runForward } from '../../flow/solve.ts';
import type { Violation } from '../finding.ts';
import { inputKey } from '../input.ts';
import { type Allowed, type NodeId, ReachState } from '../reach-state.ts';
import type { Summary } from '../summary.ts';
import { mayAlias, mayReach, mayShare } from '../type-reach.ts';
import { type AnalysisContext, BodyAnalysis } from './body.ts';
import { clonedState, type FlowState, joinedStates } from './flow-state.ts';
import { isInputRooted } from './inputs.ts';
import { Nodes } from './nodes.ts';
import { runOperation } from './operations.ts';
import type { ReachPairs } from './reach-pairs.ts';
import { type Ends, type Return, summarize } from './summarize.ts';

export interface Analysis {
  readonly summary: Summary;
  readonly violations: readonly Violation[];
  /** Its inputs' types, by `inputKey`. */
  readonly inputTypes: ReadonlyMap<string, Type>;
}

export interface AnalyzeOptions {
  readonly isAsync: boolean;
  /** Whether it is a closure's, whose callers are code nobody sees. */
  readonly nested?: boolean;
  /** The parameters taken by `&`. */
  readonly references: ReadonlySet<ValueId>;
  /**
   * Whether it is in a recursive group, whose findings name its inputs whole (inputs.ts): each
   * round lifts each member's findings into the others', and parts of parts would grow unbounded.
   */
  readonly recursive?: boolean;
}

/** Analyses `flow`, reading what it calls through `context`. */
export function analyze(
  context: AnalysisContext,
  flow: FlowFunction,
  options: AnalyzeOptions,
): Analysis {
  const nodes = new Nodes(flow, context.facts, options.recursive !== true);
  const once = holdsNothingRelevant(nodes) ? analyzedOnce(context, nodes, options) : undefined;
  return once ?? analyzedToFixpoint(context, nodes, options);
}

/** Whether no value of `nodes`' function, nor any of its inputs, may reach a disposable. */
function holdsNothingRelevant(nodes: Nodes): boolean {
  return (
    nodes.flow.values.every((_, value) => !nodes.isRelevant(value)) &&
    nodes.inputs.every((slot) => !nodes.isRelevant(slot.node))
  );
}

/**
 * A function's analysis as one pass recording what it finds, where nothing ever relates: its
 * calls still carry their callees' cycles and unseen code. Undefined where a callee's summary
 * relates something after all (a global it reaches), which only the fixed point decides.
 */
function analyzedOnce(
  context: AnalysisContext,
  nodes: Nodes,
  options: AnalyzeOptions,
): Analysis | undefined {
  const { analysis, nested } = analysisOf(context, nodes, options);
  analysis.record();
  const entry = entryState(analysis);
  const state = clonedState(entry);
  const ends = noEnds();
  const reached = reachedBlocks(nodes.flow);
  for (const block of nodes.flow.blocks.filter((_, index) => reached[index] === true)) {
    runRecording(analysis, { block, state, ends, isAsync: options.isAsync });
  }
  return state.reach.live().length > 0
    ? undefined
    : analysisFound(analysis, { nested, entry, ends, isAsync: options.isAsync });
}

/** A function's analysis run forward to its fixed point, then once more recording what it finds. */
function analyzedToFixpoint(
  context: AnalysisContext,
  nodes: Nodes,
  options: AnalyzeOptions,
): Analysis {
  const { analysis, nested } = analysisOf(context, nodes, options);
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
  const reaching = runForward(nodes.flow, rule, entry);
  analysis.record();
  const ends = noEnds();
  nodes.flow.blocks.forEach((block, index) => {
    const start = reaching[index];
    if (start !== undefined) {
      runRecording(analysis, { block, state: clonedState(start), ends, isAsync: options.isAsync });
    }
  });
  return analysisFound(analysis, { nested, entry, ends, isAsync: options.isAsync });
}

/** Where a function's callers see it, gathered as its last run passes them. */
interface Gathered extends Ends {
  readonly returns: Return[];
  readonly seen: FlowState[];
}

function noEnds(): Gathered {
  return { returns: [], seen: [] };
}

/**
 * Runs `block`'s operations on `state` on the run recording findings, gathering where the
 * function's callers see it: where it returns, and where an async one waits or stops.
 */
function runRecording(
  analysis: BodyAnalysis,
  {
    block,
    state,
    ends,
    isAsync,
  }: {
    readonly block: FlowBlock;
    readonly state: FlowState;
    readonly ends: Gathered;
    readonly isAsync: boolean;
  },
): void {
  for (const operation of block.operations) {
    runOperation(analysis, state, operation);
    if (isAsync && operation.op === 'suspend') {
      ends.seen.push(clonedState(state));
    }
  }
  if (block.exit.kind === 'return') {
    ends.returns.push({ state, value: block.exit.value });
  } else if (isAsync && block.exit.kind === 'stop') {
    ends.seen.push(state);
  }
}

/** The nested functions a function's analysis made, analysed once each. */
type NestedAnalyses = Map<FlowFunction, Analysis & { readonly isAsync: boolean }>;

/** A function's analysis as it starts, and where it keeps its nested functions'. */
function analysisOf(
  context: AnalysisContext,
  nodes: Nodes,
  options: AnalyzeOptions,
): { readonly analysis: BodyAnalysis; readonly nested: NestedAnalyses } {
  const nested: NestedAnalyses = new Map();
  const analysis = new BodyAnalysis(nodes, context, options.references, {
    separates: options.nested !== true,
    analyze: (inner, site) => {
      const known = nested.get(inner);
      if (known !== undefined) {
        return known;
      }
      const isAsync = isAsyncSite(site);
      const found = {
        ...analyze(context, inner, { isAsync, references: new Set(), nested: true }),
        isAsync,
      };
      nested.set(inner, found);
      return found;
    },
  });
  return { analysis, nested };
}

/** What `analysis` found, its nested functions' findings among its own, and its summary. */
function analysisFound(
  analysis: BodyAnalysis,
  found: {
    readonly nested: NestedAnalyses;
    readonly entry: FlowState;
    readonly ends: Ends;
    readonly isAsync: boolean;
  },
): Analysis {
  const nested = [...found.nested.values()];
  const nestedViolations = nested.flatMap(({ violations }) => violations);
  const summary = summarize(analysis, found.entry, found.ends, found.isAsync);
  return {
    summary,
    violations: [
      ...[...analysis.violations.values()].flatMap((at) => [...at.values()]),
      ...nestedViolations,
    ],
    inputTypes: new Map(
      analysis.nodes.inputs.flatMap(({ input, type }) =>
        type === undefined ? [] : [[inputKey(input), type] as const],
      ),
    ),
  };
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
  const reach = new ReachState(allowedBy(nodes, analysis.context.facts.pairs));
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

/**
 * The pairs `nodes`' types allow: a node whose type isn't known allows any. What is read out of
 * the function's inputs, and their parts, is followed back to them: findings are lifted only to
 * those (inputs.ts).
 */
function allowedBy(nodes: Nodes, pairs: ReachPairs): Allowed {
  const numbers = new Map<NodeId, number>();
  const numberOf = (node: NodeId) => memo(numbers, node, () => pairs.numberOf(nodes.reachOf(node)));
  const wholes = new Map<NodeId, boolean>();
  return {
    reach: (from, to) => pairs.allows(mayReach, numberOf(from), numberOf(to)),
    alias: (first, second) => pairs.allows(mayAlias, numberOf(first), numberOf(second)),
    share: (first, second) => pairs.allows(mayShare, numberOf(first), numberOf(second)),
    whole: (node) =>
      memo(
        wholes,
        node,
        () =>
          isInputRooted(nodes, node) ||
          nodes.inputs.some((slot) => slot.node === node || slot.value === node),
      ),
  };
}
