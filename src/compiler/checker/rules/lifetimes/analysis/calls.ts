/**
 * A call, as its callee's summary says (design.md §5.3–§5.5): its requirements checked where the
 * caller's state can decide them and lifted where its own inputs would, its effects and leaks
 * applied, and what it gives related to what it was given (given.ts). What it binds is
 * bindings.ts's.
 *
 * - **Witnesses** a generic callee is given are called with what its body passes them, which the
 *   caller doesn't see, so each witness's requirements are checked against the declaration graph
 *   for any values of its parameters' types.
 * - **Code nobody sees** (an unknown function value, a call through `any` or a requirement): what
 *   it is given escapes, it runs as unseen code, and its result may be anything escaped.
 */

import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import { type FunctionCall, witnessCallsOf } from '../../../surface/resolved-call.ts';
import type { Type } from '../../../types/type/index.ts';
import type { ValueId } from '../../flow/flow-ir.ts';
import { escapingCycles, typesBreak } from '../escaping.ts';
import { type Input, sameInput } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import { mappedCycle, type Requirement, type Summary } from '../summary.ts';
import {
  type At,
  type Bindings,
  type Bound,
  boundIn,
  closureBindings,
  ownedBy,
} from './bindings.ts';
import { type Holder, placeHolds } from './body.ts';
import { cycleOf } from './cycles.ts';
import { giveResult } from './given.ts';
import type { Owner } from './places.ts';

/** How a call is made: where, giving what, of which callee, and whether it gives its future. */
export interface CallMade {
  readonly site: NodeOf<string>;
  readonly into: ValueId;
  readonly callee: FunctionDeclaration | undefined;
  readonly call: FunctionCall | undefined;
  readonly isAsync: boolean;
}

/** Applies `summary` at a call binding `bindings`. */
export function applySummary(at: At, made: CallMade, summary: Summary, bindings: Bindings): void {
  const { analysis } = at;
  const bound = (input: Input) => boundIn(at, bindings, input);
  for (const requirement of summary.requirements) {
    checkRequirement(at, made, requirement, bound);
  }
  for (const cycle of summary.always) {
    const substituted = mappedCycle(cycle, (type) => substitutedAt(at, made, type));
    analysis.violate('instance', made.site, substituted, made.callee);
  }
  if (made.call !== undefined) {
    checkWitnesses(at, made.call, made.site);
  }
  applyEffects(at, summary, bound);
  const places = [...bindings.values()].flatMap(({ owner }) => ownedBy(owner));
  giveResult(at, made, summary, { bound, places });
  const given = [...[...bindings.values()].flatMap(({ nodes }) => nodes), made.into];
  for (const node of summary.calls.flatMap((input) => bound(input).nodes)) {
    calledBack(at, node, given, new Set());
  }
}

/**
 * A function value `node` the callee calls with what it was `given`, or what it made of it: a
 * closure this body made does what its summary says, its parameters any of those; one this
 * function was given is its own caller's to know; any other is code nobody sees.
 */
function calledBack(at: At, node: NodeId, given: readonly NodeId[], seen: Set<NodeId>): void {
  const { analysis, state } = at;
  if (seen.has(node)) {
    return;
  }
  seen.add(node);
  const known = state.callees.get(node);
  if (known?.kind === 'closure') {
    const bindings = closureBindings(at, known, node, []);
    const parameters = known.flow.parameters.map(
      (_, index) => ({ kind: 'parameter', index }) as const,
    );
    const bound = (input: Input): Bound =>
      input.kind === 'parameter' && parameters.some(({ index }) => index === input.index)
        ? { nodes: given.filter((each) => state.reach.isLive(each)), owner: undefined }
        : boundIn(at, bindings, input);
    applyEffects(at, known.summary, bound);
    for (const inner of known.summary.calls.flatMap((input) => bound(input).nodes)) {
      calledBack(at, inner, given, seen);
    }
    return;
  }
  if (known?.kind === 'items') {
    return;
  }
  const own = analysis.calledInput(state, node);
  for (const each of given) {
    analysis.leak(state, each);
  }
  analysis.runUnseen(state, { given: [node, ...given], unseen: own === undefined });
}

/** What `summary` does to what its inputs are bound to: its effects, leaks and unseen code. */
function applyEffects(at: At, summary: Summary, bound: (input: Input) => Bound): void {
  for (const effect of summary.effects) {
    const from = bound(effect.from);
    if (sameInput(effect.from, effect.to)) {
      reachesItself(at, from);
    } else {
      for (const value of bound(effect.to).nodes) {
        written(at, from, value, effect.inside);
      }
    }
  }
  for (const node of summary.leaks.flatMap((input) => bound(input).nodes)) {
    at.analysis.leak(at.state, node);
  }
  if (summary.unseen) {
    const given = summary.access.flatMap((input) => bound(input).nodes);
    at.analysis.runUnseen(at.state, { given, unseen: true });
  }
}

function substitutedAt(at: At, made: CallMade, type: Type): Type {
  return made.call === undefined ? type : at.analysis.context.substitute(type, made.call);
}

/** Checks `requirement` where the call binds its inputs, each holder against each value. */
function checkRequirement(
  at: At,
  made: CallMade,
  requirement: Requirement,
  bound: (input: Input) => Bound,
): void {
  const holderType = substitutedAt(at, made, requirement.holderType);
  const valueType =
    requirement.valueType === undefined
      ? undefined
      : substitutedAt(at, made, requirement.valueType);
  const { facts } = at.analysis.context;
  if (
    at.analysis.relevance(holderType) === 'no' ||
    (valueType !== undefined &&
      !typesBreak(facts, { holder: holderType, value: valueType }, requirement.kind))
  ) {
    return;
  }
  const holder = bound(requirement.holder);
  // A place given by `&` is written into itself, or behind a handle the value in it holds.
  const targets: readonly Target[] =
    holder.owner !== undefined && requirement.lands === 'place'
      ? [holder.owner]
      : holder.nodes.map((node) => ({ kind: 'node', node }));
  // What the call gives is written only where its own type, too, may reach the holder.
  const values = bound(requirement.value).nodes.filter((node) => {
    const type = at.analysis.nodes.typeOf(node);
    return (
      type === undefined || typesBreak(facts, { holder: holderType, value: type }, requirement.kind)
    );
  });
  for (const value of values) {
    for (const target of targets) {
      checkAt(at, made, {
        target,
        value,
        holderType,
        valueType,
        kind: requirement.kind,
        lands: requirement.lands,
      });
    }
  }
}

/** Where a write through an input lands: a node it was given, or what owns a place. */
type Target = { readonly kind: 'node'; readonly node: NodeId } | Owner;

/**
 * A requirement's pair at a call: `value` may not reach (or share with) what `target` is; a heap
 * target is the object written into, its own type the holder's rather than the callee's.
 */
interface Pair {
  readonly target: Target;
  readonly value: NodeId;
  readonly holderType: Type;
  readonly valueType: Type | undefined;
  readonly kind: Requirement['kind'];
  readonly lands: Requirement['lands'];
}

function checkAt(
  at: At,
  made: CallMade,
  { target, value, holderType, valueType, kind, lands }: Pair,
): void {
  const { analysis, state } = at;
  if (target.kind === 'value' && kind === 'reach') {
    return;
  }
  if (target.kind === 'reference' || target.kind === 'value') {
    analysis.lift(state, target.variable, value, { holderType, valueType, kind, lands });
    return;
  }
  const holder: Holder =
    target.kind === 'heap' ? target.holder : { node: target.node, exact: true, type: holderType };
  const exact = holder.exact && kind === 'reach';
  const closes = exact
    ? state.reach.closes(holder.node, value)
    : state.reach.shares(holder.node, value);
  if (closes) {
    if (analysis.recording) {
      const cycle = cycleOf(analysis, state, { ...holder, exact }, value);
      analysis.violate('call', made.site, cycle, made.callee);
    }
  } else {
    analysis.lift(state, holder.node, value, { holderType: holder.type, valueType, kind });
  }
}

/**
 * What `bound` is comes to reach itself, its parts each other: each node it was given, and the
 * variable a place it was given by `&` is; a heap place's holder reaches it already.
 */
function reachesItself({ analysis, state }: At, bound: Bound): void {
  const variable =
    bound.owner === undefined || bound.owner.kind === 'heap' ? [] : [bound.owner.variable];
  for (const node of [...bound.nodes, ...variable]) {
    analysis.link(state, { node, exact: true }, node, false);
  }
}

/** `value` comes to be reached from what `holder` is bound to. */
function written(at: At, holder: Bound, value: NodeId, inside: boolean): void {
  const { analysis, state } = at;
  const { owner } = holder;
  if (owner === undefined) {
    for (const node of holder.nodes) {
      analysis.link(state, { node, exact: true }, value, inside);
    }
  } else if (owner.kind === 'heap') {
    analysis.link(state, owner.holder, value, inside);
    for (const place of inside ? [] : holder.nodes) {
      placeHolds(state, owner.holder, place, value);
    }
  } else {
    state.reach.contain(owner.variable, value);
    analysis.endPathsFrom(state, owner.variable);
  }
}

/**
 * The witnesses `call` gives its callee are run by it with values the caller doesn't see, as code
 * its body can't see: each one's writes are checked for any values of its parameters' types
 * (design.md §5.4).
 */
function checkWitnesses({ analysis }: At, call: FunctionCall, site: NodeOf<string>): void {
  const { context } = analysis;
  for (const witness of witnessCallsOf(call.witnesses)) {
    const summary = context.calleeSummary(witness) ?? { requirements: [], always: [] };
    const parameters = context.parametersOf(witness.function);
    const substituted = (type: Type) => context.substitute(type, witness);
    const typeOf = (input: Input) => {
      const type = input.kind === 'parameter' ? parameters[input.index]?.type : undefined;
      return type === undefined ? undefined : substituted(type);
    };
    const cycles = escapingCycles(
      context.facts,
      {
        requirements: summary.requirements.map((requirement) => ({
          ...requirement,
          holderType: substituted(requirement.holderType),
        })),
        always: summary.always.map((cycle) => mappedCycle(cycle, substituted)),
      },
      typeOf,
    );
    for (const cycle of cycles) {
      analysis.violate('witness', site, cycle, witness.function);
    }
  }
}

/**
 * A call of code nobody sees: what it is given escapes, and its result is anything that code may
 * reach, which it may keep: the result is handed to unseen code too, so the code relates it to
 * what it reaches. A function value this function was given is code its caller may know
 * (`unseen` false): only code nobody can know makes the summary say it runs unseen code.
 */
export function unknownCall(at: At, into: ValueId, given: readonly NodeId[], unseen = true): void {
  const { analysis, state } = at;
  for (const node of given) {
    analysis.leak(state, node);
  }
  if (analysis.nodes.isRelevant(into)) {
    state.reach.fresh(into);
    state.reach.escape(into);
  }
  analysis.runUnseen(state, { given, unseen });
}
