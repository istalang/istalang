/**
 * What a call gives its callee's inputs (calls.ts applies a summary over them): the nodes each
 * argument is, by the callee's parameters.
 *
 * - **Arguments bind by parameter** (`Binding`): a rest parameter takes each item, a default none.
 * - **An argument by `&`** is its place: its value stands for the parameter, and a write through it
 *   lands in what owns the place (places.ts).
 * - **A temporary naming a variable or a path** binds as that, so what the callee is given stays
 *   named past the statement making the call.
 * - **A global the callee names** binds to the caller's own node for it, given as it was, so the
 *   caller's summary names it in turn.
 */

import type { FunctionCall } from '../../../surface/resolved-call.ts';
import type { Argument } from '../../flow/flow-ir.ts';
import type { NodeId } from '../reach-state.ts';
import { type Input, inputKey } from '../summary.ts';
import type { BodyAnalysis } from './body.ts';
import { type FlowState, type MadeClosure, materialize } from './flow-state.ts';
import { type Owner, placeTarget } from './places.ts';

/** Where a call is made: the analysis making it, and its state there. */
export interface At {
  readonly analysis: BodyAnalysis;
  readonly state: FlowState;
}

/** What a call gives one of its callee's inputs: the nodes it is, and what owns it if a place. */
export interface Bound {
  readonly nodes: readonly NodeId[];
  readonly owner: Owner | undefined;
}

/** What a call gives each input of its callee, by `inputKey`. */
export type Bindings = ReadonlyMap<string, Bound>;

const unbound: Bound = { nodes: [], owner: undefined };

/** The inputs a call of a function binds, from `call`'s binding of `args`. */
export function functionBindings(
  at: At,
  call: Pick<FunctionCall, 'binding'>,
  args: readonly Argument[],
): Bindings {
  const bindings = new Map<string, Bound>();
  call.binding.forEach((source, index) => {
    const input: Input = { kind: 'parameter', index };
    if (source.kind === 'argument') {
      bindings.set(inputKey(input), argumentBound(at, args[source.index]));
    } else if (source.kind === 'rest') {
      const items = source.items.map((item) => argumentBound(at, args[item.index]));
      bindings.set(inputKey(input), {
        nodes: items.flatMap(({ nodes }) => nodes),
        owner: undefined,
      });
    }
  });
  return bindings;
}

/** The inputs a call of a closure this body made binds: its arguments, captures, cells and self. */
export function closureBindings(
  at: At,
  closure: MadeClosure,
  callee: NodeId,
  args: readonly Argument[],
): Bindings {
  const { nodes } = at.analysis;
  const bindings = new Map<string, Bound>();
  args.forEach((argument, index) => {
    bindings.set(inputKey({ kind: 'parameter', index }), argumentBound(at, argument));
  });
  closure.parts.forEach((part, index) => {
    bindings.set(inputKey({ kind: 'capture', index }), nodesBound(at.state, [part]));
    if (nodes.isCell(part)) {
      bindings.set(inputKey({ kind: 'cell', index }), nodesBound(at.state, [nodes.cell(part)]));
    }
  });
  bindings.set(inputKey({ kind: 'self' }), nodesBound(at.state, [callee]));
  return bindings;
}

/**
 * What `input` is bound to: as `bindings` say; for a global, the caller's own; for a part of an
 * input, that part of what the input is bound to.
 */
export function boundIn(at: At, bindings: Bindings, input: Input): Bound {
  if (input.kind === 'path') {
    const { nodes, state } = { nodes: at.analysis.nodes, state: at.state };
    const parts = boundIn(at, bindings, input.of).nodes.flatMap((root) => {
      const node = nodes.path(root, input.part, input.read, input.type);
      return state.reach.isLive(node) || materialize(nodes, state, node) ? [node] : [];
    });
    return { nodes: parts, owner: undefined };
  }
  return bindings.get(inputKey(input)) ?? globalBound(at, input);
}

function argumentBound(at: At, argument: Argument | undefined): Bound {
  if (argument === undefined) {
    return unbound;
  }
  if (argument.kind === 'value') {
    const named = at.analysis.canonOf(at.state, argument.value) ?? argument.value;
    return nodesBound(at.state, [named]);
  }
  const target = placeTarget(at.analysis, at.state, argument.place);
  return { ...nodesBound(at.state, [target.value]), owner: target.owner };
}

function nodesBound(state: FlowState, nodes: readonly NodeId[]): Bound {
  return { nodes: nodes.filter((node) => state.reach.isLive(node)), owner: undefined };
}

function globalBound(at: At, input: Input): Bound {
  if (input.kind !== 'global') {
    return unbound;
  }
  const slot = at.analysis.nodes.globalInput(input.entity, input.type);
  if (!at.state.reach.isLive(slot.node)) {
    at.state.reach.fresh(slot.node);
    at.state.reach.markEscaped(slot.node);
  }
  return { nodes: [slot.node], owner: undefined };
}

/** The nodes `args` give: values, and places by their values and owners. */
export function nodesGiven(at: At, args: readonly Argument[]): readonly NodeId[] {
  return args.flatMap((argument) => {
    const { nodes, owner } = argumentBound(at, argument);
    return [...nodes, ...ownedBy(owner)];
  });
}

function ownedBy(owner: Owner | undefined): readonly NodeId[] {
  if (owner === undefined) {
    return [];
  }
  return owner.kind === 'heap' ? [owner.holder.node] : [owner.variable];
}
