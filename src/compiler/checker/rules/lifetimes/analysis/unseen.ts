/**
 * Code the body doesn't see (design.md §5.5): other executions, where the body suspends, and
 * calls of function values it doesn't know. What such code may reach may come to reach each other
 * as the declaration graph allows; what reaches that comes to reach it too; and the paths read
 * through what it may write may change.
 *
 * - **Other executions** may reach anything escaped.
 * - **A call of code nobody sees** reaches only what it is given, the globals, what this body handed
 *   such code before, and what those reach. It relies on each input it doesn't reach sharing nothing
 *   with each it does, which each caller is required to see to (`share`), on the inputs and their
 *   parts as given, so a caller passing two fields of one value checks those fields. A closure's
 *   callers are code nobody sees, so in a closure's body (`separates` false) such a call may reach
 *   anything escaped too.
 */

import { isHandleType } from '../../../types/properties/handles.ts';
import { inputKey } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import { anyField } from '../summary.ts';
import { type HandleReach, mayAlias, mayReach, mayShare } from '../type-reach.ts';
import type { BodyAnalysis } from './body.ts';
import type { FlowState } from './flow-state.ts';
import { apart, candidatesIn } from './inputs.ts';

/** A call of code nobody sees: what it was given, and whether nobody can know that code. */
export interface UnseenCall {
  readonly given: readonly NodeId[];
  readonly unseen: boolean;
}

/** Runs code nobody sees: other executions, or the code `call` runs. */
export function runUnseen(analysis: BodyAnalysis, state: FlowState, call?: UnseenCall): void {
  if (call?.unseen === true) {
    analysis.unseen = true;
  }
  const all = call === undefined || !analysis.separates;
  const reached = new Set(
    [
      ...(all ? state.reach.escaped() : []),
      ...(call === undefined ? [] : accessFrom(analysis, state, call.given)),
    ].filter((node) => analysis.nodes.isRelevant(node) && state.reach.isLive(node)),
  );
  for (const path of analysis.nodes.allPaths()) {
    const read = analysis.nodes.pathOf(path);
    if (read?.kind === 'through' && state.reach.isLive(path) && reached.has(read.root)) {
      analysis.endPath(state, path);
    }
  }
  if (call !== undefined) {
    separate(analysis, state, reached, !all);
  }
  closeOver(
    analysis,
    state,
    [...reached].filter((node) => state.reach.isLive(node)),
  );
}

/** What code given `given` may reach: those, the globals, what was leaked, and what they reach. */
function accessFrom(
  analysis: BodyAnalysis,
  state: FlowState,
  given: readonly NodeId[],
): readonly NodeId[] {
  const globals = analysis.nodes.inputs
    .filter((slot) => slot.input.kind === 'global')
    .flatMap((slot) => [slot.node, slot.value]);
  const reached = new Set<NodeId>();
  const pending = [...given, ...globals, ...state.reach.leaked()];
  while (pending.length > 0) {
    const node = pending.pop() as NodeId;
    if (!reached.has(node) && state.reach.isLive(node)) {
      reached.add(node);
      pending.push(...state.reach.reachedFrom(node), ...state.reach.aliasesOf(node));
    }
  }
  return [...reached];
}

/**
 * Notes the inputs unseen code may reach (`access`), and, where the body relies on that
 * (`requires`), requires each input (or part of one) it reaches to share nothing with each that
 * shares nothing with what it reaches: one sharing with that already comes to reach what it may.
 */
function separate(
  analysis: BodyAnalysis,
  state: FlowState,
  reached: ReadonlySet<NodeId>,
  requires: boolean,
): void {
  if (!analysis.recording) {
    return;
  }
  const candidates = candidatesIn(analysis, state);
  const inside = candidates.filter(({ node }) => reached.has(node));
  for (const { input } of inside.filter(({ input: each }) => each.kind !== 'path')) {
    analysis.access.set(inputKey(input), input);
  }
  const outside = candidates.filter(
    ({ node }) =>
      requires &&
      !reached.has(node) &&
      ![...reached].some((each) => state.reach.shares(node, each)),
  );
  for (const holder of outside) {
    const holderType = analysis.nodes.typeOf(holder.node);
    for (const value of inside.filter((each) => apart(each.input, holder.input))) {
      if (holderType !== undefined) {
        analysis.require({
          kind: 'share',
          holder: holder.input,
          value: value.input,
          holderType,
          valueType: analysis.nodes.typeOf(value.node),
          lands: 'behind',
          label: anyField,
        });
      }
    }
  }
}

/** What `live` may come to reach of each other, and what reaches them comes to reach too. */
function closeOver(analysis: BodyAnalysis, state: FlowState, live: readonly NodeId[]): void {
  const reaches = live.map((node) => [node, analysis.nodes.reachOf(node)] as const);
  for (const [index, [first, firstReach]] of reaches.entries()) {
    for (const [second, secondReach] of reaches.slice(index + 1)) {
      if (!oneHandle(analysis, state, [first, second])) {
        relateByTypes(state, [first, firstReach], [second, secondReach]);
      }
    }
  }
  const reached = new Set(live);
  const reaching = state.reach.live().filter((node) => !reached.has(node));
  for (const node of reaching) {
    const through = live.filter(
      (each) => state.reach.reaches(node, each) || state.reach.aliases(node, each),
    );
    for (const target of through.flatMap((each) => [
      ...state.reach.reachedFrom(each),
      ...state.reach.aliasesOf(each),
    ])) {
      state.reach.addReach(node, target);
    }
  }
}

/**
 * Whether two handles are one object: an input as given and the variable of its parameter, which
 * still holds it. Then neither can come to reach the other but through a cycle, which none may pass
 * through (design.md §1). Two values that only may alias may be two objects, and are related as
 * their types allow.
 */
function oneHandle(
  analysis: BodyAnalysis,
  state: FlowState,
  [first, second]: readonly [NodeId, NodeId],
): boolean {
  const types = [analysis.nodes.typeOf(first), analysis.nodes.typeOf(second)];
  const given = analysis.nodes.inputs.some(
    ({ node, value }) =>
      (node === first && value === second) || (node === second && value === first),
  );
  return (
    given &&
    state.reach.aliases(first, second) &&
    types.every((type) => type !== undefined && isHandleType(type))
  );
}

/** Relates two nodes as the declaration graph says values of their types may come to be. */
export function relateByTypes(
  state: Pick<FlowState, 'reach'>,
  [first, firstReach]: readonly [NodeId, HandleReach],
  [second, secondReach]: readonly [NodeId, HandleReach],
): void {
  if (mayReach(firstReach, secondReach)) {
    state.reach.addReach(first, second);
    state.reach.addWhole(second, first);
  }
  if (mayReach(secondReach, firstReach)) {
    state.reach.addReach(second, first);
    state.reach.addWhole(first, second);
  }
  if (mayAlias(firstReach, secondReach)) {
    state.reach.addAlias(first, second);
  } else if (mayShare(firstReach, secondReach)) {
    state.reach.addShare(first, second);
  }
}
