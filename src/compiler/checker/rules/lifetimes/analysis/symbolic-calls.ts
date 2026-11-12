/**
 * Calls through requirements a body can't resolve yet, and how a call of its function resolves
 * them (design.md §5.4, ../symbolic.ts).
 *
 * - **Recorded** where a body calls a requirement of its own type parameters: for each ordered
 *   pair of arguments, what a witness writing one into the other would meet there.
 * - **Resolved** where a call instantiates the function: each symbolic call closed inside that
 *   call's instance (C1's closing), each witness it reaches summed up over the call's arguments,
 *   and each requirement of that witness read off the pair of arguments it names: a cycle the body
 *   closed there, or requirements on the body's own inputs. A call still open names its caller's
 *   own type parameters, and goes on into the caller's summary, its pairs over the caller's state.
 * - **By types:** what each instantiation checks against the declaration graph.
 */

import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { SignatureParameter } from '../../../check.ts';
import type {
  FunctionCall,
  RequirementCall,
  ResolvedCall,
} from '../../../surface/resolved-call.ts';
import { typeKeys } from '../../../types/identity/type-keys.ts';
import { isKnown } from '../../../types/parts/type-parts.ts';
import type { AnyType, Type } from '../../../types/type/index.ts';
import type { Argument } from '../../flow/flow-ir.ts';
import { boundBy } from '../composition.ts';
import { decidingType, type EscapingFacts, escapingCycles } from '../escaping.ts';
import type { Input } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import type { Requirement, Summary, TypedCycle } from '../summary.ts';
import {
  type ArgumentPair,
  type ByTypes,
  type InputPair,
  mappedByTypes,
  mergedSymbolic,
  type SymbolicCall,
  symbolicKey,
  uniquePairs,
} from '../symbolic.ts';
import { type At, type Bound, nodesGiven, ownedBy } from './bindings.ts';

/** What resolving symbolic calls reads of the program. */
export interface Resolving {
  readonly facts: EscapingFacts & { readonly keyOf: (type: Type) => string };
  readonly calleeSummary: (call: FunctionCall) => Summary | undefined;
  readonly substitute: (type: Type, call: FunctionCall) => Type;
  readonly parametersOf: (declaration: FunctionDeclaration) => readonly SignatureParameter[];
  /** `call` closed inside the instance `within` runs (C1's closing). */
  readonly closedIn: (call: RequirementCall, within: FunctionCall) => ResolvedCall;
  /** The witnesses `call` runs, where they are known; undefined where its types aren't yet. */
  readonly witnessesOf: (call: RequirementCall) => readonly FunctionCall[] | undefined;
  /** The witnesses of `to`'s requirements a value of `member` put into it carries. */
  readonly conversionWitnesses: (to: AnyType, member: Type) => readonly FunctionCall[];
}

/** Records the symbolic call `call` makes of `args` (the header). */
export function recordSymbolic(at: At, call: RequirementCall, args: readonly Argument[]): void {
  const { analysis, state } = at;
  if (!analysis.recording) {
    return;
  }
  const given = args.map((argument) =>
    nodesGiven(at, [argument]).filter(
      (node) => state.reach.isLive(node) && analysis.nodes.isRelevant(node),
    ),
  );
  const pairs = given.flatMap((holders, holder) =>
    given.flatMap((values, value): readonly ArgumentPair[] =>
      holder === value || holders.length === 0 || values.length === 0
        ? []
        : [pairAt(at, { holder, value }, holders, values)],
    ),
  );
  recorded(at, { call, pairs });
}

/** Notes `call` among the body's symbolic calls, one per requirement called, its pairs joined. */
function recorded({ analysis }: At, call: SymbolicCall): void {
  const key = symbolicKey(analysis.context.facts.keyOf, call.call);
  const known = analysis.symbolic.get(key);
  analysis.symbolic.set(key, known === undefined ? call : mergedSymbolic(known, call));
}

/** What writing one of `values` into one of `holders` meets in the state `at` has. */
function pairAt(
  { analysis, state }: At,
  indices: { readonly holder: number; readonly value: number },
  holders: readonly NodeId[],
  values: readonly NodeId[],
): ArgumentPair {
  const each = <Found>(found: (holder: NodeId, value: NodeId) => readonly Found[]) =>
    holders.flatMap((holder) => values.flatMap((value) => found(holder, value)));
  return {
    ...indices,
    closes: each((holder, value) => (state.reach.closes(holder, value) ? [true] : [])).length > 0,
    shares: each((holder, value) => (state.reach.shares(holder, value) ? [true] : [])).length > 0,
    reach: uniquePairs(
      each((holder, value) => analysis.liftedPairs(state, holder, value, 'reach')),
    ),
    share: uniquePairs(
      each((holder, value) => analysis.liftedPairs(state, holder, value, 'share')),
    ),
  };
}

/**
 * `summary` with its symbolic calls resolved inside the instance `instance` runs, and what it
 * checks by types checked where known (the header); those still open are left in it.
 */
export function resolvedWithin(
  resolving: Resolving,
  summary: Summary,
  instance: FunctionCall,
  seen: ReadonlySet<FunctionDeclaration> = new Set(),
): Summary {
  if (
    (summary.symbolic.length === 0 && summary.byTypes.length === 0) ||
    seen.has(instance.function)
  ) {
    return summary;
  }
  // One summary is resolved inside one instance alike wherever it is called: once.
  const key = [
    instanceKey(resolving.facts.keyOf, instance),
    ...[...seen].map((each) => typeKeys.identityOf(each)),
  ].join(';');
  const known = resolutions.get(summary)?.get(key);
  if (known !== undefined) {
    return known;
  }
  const resolved = resolvedFresh(resolving, summary, instance, seen);
  const ofSummary = resolutions.get(summary) ?? new Map<string, Summary>();
  resolutions.set(summary, ofSummary.set(key, resolved));
  return resolved;
}

const resolutions = new WeakMap<Summary, Map<string, Summary>>();

/** A key naming the instance `call` runs: its function, type arguments and witnesses. */
function instanceKey(keyOf: (type: Type) => string, call: ResolvedCall): string {
  const witnesses = [...call.witnesses].map(
    ([parameter, constraints]) =>
      `${typeKeys.identityOf(parameter)}:${constraints
        .map((calls) => calls.map((each) => instanceKey(keyOf, each)).join(','))
        .join('/')}`,
  );
  return `${typeKeys.identityOf(call.function)}<${call.typeArguments.map(keyOf).join(',')}>{${witnesses.join(';')}}`;
}

/** What resolving adds to a summary: requirements, cycles, and what stays for instantiations. */
type Added = Pick<Summary, 'requirements' | 'always' | 'symbolic' | 'byTypes'>;

function resolvedFresh(
  resolving: Resolving,
  summary: Summary,
  instance: FunctionCall,
  seen: ReadonlySet<FunctionDeclaration>,
): Summary {
  const within = new Set([...seen, instance.function]);
  const added: readonly Added[] = [
    { ...summary, symbolic: [], byTypes: [] },
    ...summary.symbolic.map((call) => closedCall(resolving, call, instance, within)),
    ...summary.byTypes.map((checked) => checkedByTypes(resolving, checked, instance, within)),
  ];
  return {
    ...summary,
    requirements: added.flatMap(({ requirements }) => requirements),
    always: added.flatMap(({ always }) => always),
    symbolic: added.flatMap(({ symbolic }) => symbolic),
    byTypes: added.flatMap(({ byTypes }) => byTypes),
  };
}

/** What the symbolic `call` adds once closed inside `instance`; itself, closed, while open. */
function closedCall(
  resolving: Resolving,
  call: SymbolicCall,
  instance: FunctionCall,
  seen: ReadonlySet<FunctionDeclaration>,
): Added {
  const closed = resolving.closedIn(call.call, instance);
  const witnesses = overArguments(resolving, closed, seen);
  if (witnesses === undefined) {
    return {
      requirements: [],
      always: [],
      symbolic: [{ ...call, call: closed as RequirementCall }],
      byTypes: [],
    };
  }
  return {
    requirements: witnesses.flatMap((witness) =>
      witness.requirements.flatMap((requirement) => {
        const pair = pairOf(call.pairs, requirement.holder, requirement.value);
        const inputs = requirement.kind === 'reach' ? pair?.reach : pair?.share;
        return (inputs ?? []).map((each) => ({ ...requirement, ...each }));
      }),
    ),
    always: witnesses.flatMap((witness) => [
      ...witness.requirements.flatMap((requirement) => {
        const pair = pairOf(call.pairs, requirement.holder, requirement.value);
        const closes = requirement.kind === 'reach' ? pair?.closes : pair?.shares;
        return closes === true ? [cycleOf(resolving.facts, requirement)] : [];
      }),
      ...witness.always,
    ]),
    symbolic: witnesses.flatMap((witness) =>
      witness.symbolic.map((inner) => composed(inner, call.pairs)),
    ),
    byTypes: witnesses.flatMap((witness) => witness.byTypes),
  };
}

/** What `checked` adds once known inside `instance`: its cycles, or itself while not known. */
function checkedByTypes(
  resolving: Resolving,
  checked: ByTypes,
  instance: FunctionCall,
  seen: ReadonlySet<FunctionDeclaration>,
): Added {
  const known = mappedByTypes(checked, (type) => resolving.substitute(type, instance));
  const cycles = byTypesCycles(resolving, known, instance, seen);
  return cycles === undefined
    ? { requirements: [], always: [], symbolic: [], byTypes: [known] }
    : { requirements: [], always: cycles, symbolic: [], byTypes: [] };
}

/**
 * The summaries of the witnesses `closed` runs, each resolved inside its own instance and over the
 * arguments of the call closed; undefined where they aren't known yet.
 */
function overArguments(
  resolving: Resolving,
  closed: ResolvedCall,
  seen: ReadonlySet<FunctionDeclaration>,
): readonly Summary[] | undefined {
  const summed = (witness: FunctionCall) => {
    const summary = resolving.calleeSummary(witness);
    return summary === undefined ? undefined : resolvedWithin(resolving, summary, witness, seen);
  };
  if (closed.kind === 'function') {
    const summary = summed(closed);
    return summary === undefined
      ? []
      : [boundBy(summary, closed.binding, (type) => resolving.substitute(type, closed))];
  }
  const witnesses = resolving.witnessesOf(closed);
  return witnesses?.flatMap((witness) => {
    const summary = summed(witness);
    if (summary === undefined) {
      return [];
    }
    const required = boundBy(summary, witness.binding, (type) =>
      resolving.substitute(type, witness),
    );
    return [boundBy(required, closed.binding, (type) => type)];
  });
}

/** The cycles what `checked` checks by types closes, once known; undefined while it isn't. */
function byTypesCycles(
  resolving: Resolving,
  checked: ByTypes,
  instance: FunctionCall,
  seen: ReadonlySet<FunctionDeclaration>,
): readonly TypedCycle[] | undefined {
  let witnesses: readonly FunctionCall[] | undefined;
  if (checked.kind === 'conversion') {
    witnesses = isKnown(checked.member)
      ? resolving.conversionWitnesses(checked.to, checked.member)
      : undefined;
  } else {
    const closed = resolving.closedIn(checked.call, instance);
    witnesses = closed.kind === 'function' ? [closed] : resolving.witnessesOf(closed);
  }
  return witnesses?.flatMap((witness) => {
    const summary = resolving.calleeSummary(witness);
    if (summary === undefined) {
      return [];
    }
    const parameters = resolving.parametersOf(witness.function);
    return escapingCycles(
      resolving.facts,
      resolvedWithin(resolving, summary, witness, seen),
      (input) => {
        const type = input.kind === 'parameter' ? parameters[input.index]?.type : undefined;
        return type === undefined ? undefined : resolving.substitute(type, witness);
      },
    );
  });
}

/** The parameter `input` is, or a part of; undefined for any other input. */
function argumentOf(input: Input): number | undefined {
  if (input.kind === 'path') {
    return argumentOf(input.of);
  }
  return input.kind === 'parameter' ? input.index : undefined;
}

/** Of `pairs`, the one naming the arguments `holder` and `value` are. */
function pairOf(
  pairs: readonly ArgumentPair[],
  holder: Input,
  value: Input,
): ArgumentPair | undefined {
  const [at, of] = [argumentOf(holder), argumentOf(value)];
  return pairs.find((pair) => pair.holder === at && pair.value === of);
}

/** The cycle a witness's write closes where its arguments already are one. */
function cycleOf(facts: EscapingFacts, requirement: Requirement): TypedCycle {
  const value = requirement.valueType ?? requirement.holderType;
  return {
    holder: requirement.holderType,
    through: [value],
    sources: [],
    kind: requirement.kind,
    deciding: decidingType(facts, requirement.holderType, value),
  };
}

/** `inner`, a witness's own symbolic call over the outer call's arguments, over the body's. */
function composed(inner: SymbolicCall, outer: readonly ArgumentPair[]): SymbolicCall {
  const through = (pairs: readonly InputPair[], kind: 'reach' | 'share') =>
    pairs.flatMap((pair) => pairOf(outer, pair.holder, pair.value)?.[kind] ?? []);
  const meets = (pairs: readonly InputPair[], kind: 'closes' | 'shares') =>
    pairs.some((pair) => pairOf(outer, pair.holder, pair.value)?.[kind] === true);
  return {
    call: inner.call,
    pairs: inner.pairs.map((pair) => ({
      ...pair,
      closes: pair.closes || meets(pair.reach, 'closes'),
      shares: pair.shares || meets(pair.share, 'shares'),
      reach: uniquePairs(through(pair.reach, 'reach')),
      share: uniquePairs(through(pair.share, 'share')),
    })),
  };
}

/**
 * Records a callee's symbolic call still open after its call closed it as the caller's own, its
 * pairs over the caller's state: the inputs it named bound by the call (`bound`).
 */
export function forwardSymbolic(at: At, call: SymbolicCall, bound: (input: Input) => Bound): void {
  const { analysis, state } = at;
  if (!analysis.recording) {
    return;
  }
  const targets = (input: Input) => {
    const { nodes, owner } = bound(input);
    return owner === undefined ? nodes : ownedBy(owner);
  };
  const across = <Found>(
    inputPairs: readonly InputPair[],
    found: (holder: NodeId, value: NodeId) => readonly Found[],
  ) =>
    inputPairs.flatMap((pair) =>
      targets(pair.holder).flatMap((holder) =>
        bound(pair.value).nodes.flatMap((value) => found(holder, value)),
      ),
    );
  const pairs = call.pairs.map((pair) => ({
    ...pair,
    closes:
      pair.closes ||
      across(pair.reach, (holder, value) => (state.reach.closes(holder, value) ? [true] : []))
        .length > 0,
    shares:
      pair.shares ||
      across(pair.share, (holder, value) => (state.reach.shares(holder, value) ? [true] : []))
        .length > 0,
    reach: uniquePairs(
      across(pair.reach, (holder, value) => analysis.liftedPairs(state, holder, value, 'reach')),
    ),
    share: uniquePairs(
      across(pair.share, (holder, value) => analysis.liftedPairs(state, holder, value, 'share')),
    ),
  }));
  recorded(at, { call: call.call, pairs });
}
