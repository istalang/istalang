/**
 * One flow function's analysis as it runs (index.ts drives it): the nodes, what it found, and the
 * updates every operation shares (operations.ts, calls.ts).
 *
 * - **Writes** (design.md §2) are where a cycle closes: one whose value may reach its holder is a
 *   violation; otherwise each pair of inputs that would make it one is a requirement of the
 *   function's callers (design.md §5.3). Inputs are unrelated as the function starts, so only a
 *   value sharing with one input, written into a holder another input reaches, can close a cycle
 *   once called: an input reaching itself would be a cycle its caller already has.
 * - **Paths** stay one value until a write may change them: a write into a handle ends the paths
 *   through what may be it, assigning a variable ends the paths from it, and unseen code ends the
 *   paths from what it may reach.
 * - **Unseen code** (design.md §5.5) may make what it can reach reach each other as their types
 *   allow, the declaration graph's answer; what reaches those comes to reach that too.
 * - **Findings are made once,** on the last run over the fixed point, whose states hold every
 *   earlier one's (`recording`).
 */

import type { FunctionDeclaration } from '../../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { SignatureParameter } from '../../../check.ts';
import type { FunctionCall, RequirementCall } from '../../../surface/resolved-call.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowFunction, ValueId } from '../../flow/flow-ir.ts';
import { cycleRelevance } from '../escaping.ts';
import type { LifetimeFinding } from '../finding.ts';
import { type Input, type InputPair, inputKey } from '../input.ts';
import type { NodeId } from '../reach-state.ts';
import {
  anyField,
  type GivenValue,
  type Requirement,
  type Summary,
  type TypedCycle,
} from '../summary.ts';
import { moreRelevant, type Relevance } from '../type-reach.ts';
import { cycleOf } from './cycles.ts';
import type { FlowState } from './flow-state.ts';
import { apart, candidatesIn } from './inputs.ts';
import type { Nodes, TypeFacts } from './nodes.ts';
import { runUnseen, type UnseenCall } from './unseen.ts';

/** What an analysis reads beyond its body: types, and what the functions it calls do. */
export interface AnalysisContext {
  readonly facts: TypeFacts & { readonly keyOf: (type: Type) => string };
  /** What `call`'s function does; undefined where that is code nobody can see. */
  readonly calleeSummary: (call: FunctionCall) => Summary | undefined;
  readonly parametersOf: (declaration: FunctionDeclaration) => readonly SignatureParameter[];
  /** `type`, written in `call`'s function, as `call` instantiates it. */
  readonly substitute: (type: Type, call: FunctionCall) => Type;
  /** Whether `iterate`'s cursor gives the items of what it is given and does nothing else. */
  readonly readsWhatItIterates: (iterate: FunctionDeclaration) => boolean;
  /**
   * The witnesses a call through a requirement runs where they are known (dispatch.ts); undefined
   * where this body can't see them, which it calls as code nobody sees.
   */
  readonly witnessesOf: (call: RequirementCall) => readonly FunctionCall[] | undefined;

  /** What the default of `declaration`'s parameter at `index` relates to, of those before it. */
  readonly defaultResult: (declaration: FunctionDeclaration, index: number) => GivenValue;
}

/** Where a cycle may close in this function's text (`LifetimeFinding`, the function aside). */
export type Violation = Omit<LifetimeFinding, 'declaration'>;

/** What analysing a nested function gives the body making its closure. */
export interface NestedResult {
  readonly summary: Summary;
  readonly isAsync: boolean;
  /** Its inputs' types, by `inputKey`. */
  readonly inputTypes: ReadonlyMap<string, Type>;
}

/** Where a write lands: in the cell of `node`'s handle, or, not `exact`, of one it reaches. */
export interface Written {
  readonly node: NodeId;
  readonly exact: boolean;
}

/** A write's holder, and its type. */
export interface Holder extends Written {
  readonly type: Type;
}

export class BodyAnalysis {
  readonly nodes: Nodes;
  readonly context: AnalysisContext;
  readonly references: ReadonlySet<ValueId>;
  readonly violations = new Map<NodeOf<string>, Map<string, Violation>>();
  readonly requirements = new Map<string, Requirement>();
  readonly always = new Map<string, TypedCycle>();
  readonly leaks = new Map<string, Input>();
  readonly calls = new Map<string, Input>();
  /** Analyses a nested function, its closure made at `site`, its findings joining this one's. */
  readonly analyzeNested: (flow: FlowFunction, site: NodeOf<string>) => NestedResult;
  /** Whether its callers are seen, so it may rely on what they are required to see to. */
  readonly separates: boolean;
  /** The inputs code it runs unseen may reach. */
  readonly access = new Map<string, Input>();
  #recording = false;
  unseen = false;

  constructor(
    nodes: Nodes,
    context: AnalysisContext,
    references: ReadonlySet<ValueId>,
    nesting: {
      readonly analyze: BodyAnalysis['analyzeNested'];
      readonly separates: boolean;
    },
  ) {
    this.nodes = nodes;
    this.context = context;
    this.references = references;
    this.analyzeNested = nesting.analyze;
    this.separates = nesting.separates;
  }

  /** Whether findings are made: on the last run, over the fixed point (index.ts). */
  get recording(): boolean {
    return this.#recording;
  }

  record(): void {
    this.#recording = true;
  }

  /** The variable or path a value names, if it names one: a read through it reads that path. */
  canonOf(state: FlowState, value: ValueId): NodeId | undefined {
    const known = state.canon.get(value);
    if (known !== undefined) {
      return state.reach.isLive(known) ? known : undefined;
    }
    const found = this.nodes.flow.values[value];
    return found?.kind === 'temporary' ? undefined : value;
  }

  /** `variable` takes `from`'s value, ending the paths from what it held. */
  assign(state: FlowState, variable: ValueId, from: ValueId): void {
    this.endPathsFrom(state, variable);
    if (state.reach.isLive(from)) {
      state.reach.copy(variable, from);
      this.carryPaths(state, variable, from);
    } else {
      state.reach.fresh(variable);
    }
  }

  /** `into`, a copy of `from`, has the parts read of it read of `into` too: one value. */
  carryPaths(state: FlowState, into: NodeId, from: NodeId): void {
    for (const path of this.nodes.pathsFrom(from).filter((each) => state.reach.isLive(each))) {
      const read = this.nodes.pathOf(path);
      if (read !== undefined) {
        const carried = this.nodes.path(into, read.part, read.kind, read.type);
        state.reach.copy(carried, path);
        this.carryPaths(state, carried, path);
      }
    }
  }

  /** `value` ends, and the paths from it. */
  release(state: FlowState, value: ValueId): void {
    this.endPathsFrom(state, value);
    state.reach.kill(value);
    state.callees.delete(value);
    state.gives.delete(value);
  }

  /** Ends the paths read from `root`, and from those. */
  endPathsFrom(state: FlowState, root: NodeId): void {
    for (const path of this.nodes.pathsFrom(root)) {
      if (state.reach.isLive(path)) {
        this.endPath(state, path);
      }
    }
    for (const [value, named] of state.canon) {
      if (named === root) {
        state.canon.delete(value);
      }
    }
  }

  endPath(state: FlowState, path: NodeId): void {
    this.endPathsFrom(state, path);
    state.reach.kill(path);
  }

  /**
   * Ends the paths read through the cell `holder`'s write lands in: through a handle that may be
   * it, or, where the holder is known only as reached from a node (`exact` false), one that node
   * may reach. A path through any other cell names what it did.
   */
  endPathsThrough(state: FlowState, { node: holder, exact }: Written): void {
    const written = (root: NodeId) =>
      state.reach.aliases(root, holder) || (!exact && state.reach.reaches(holder, root));
    const through = this.nodes.allPaths().filter((path) => {
      const read = this.nodes.pathOf(path);
      return read?.kind === 'through' && state.reach.isLive(path) && written(read.root);
    });
    for (const path of through.filter((each) => state.reach.isLive(each))) {
      this.endPath(state, path);
    }
  }

  /**
   * `value` written into `holder`'s cell: a violation where it may reach the holder already, else
   * a requirement on the inputs that would make it one; then what reaches the holder reaches it.
   */
  write(state: FlowState, holder: Holder, value: NodeId, site: NodeOf<string>): void {
    const closes = holder.exact
      ? state.reach.closes(holder.node, value)
      : state.reach.shares(holder.node, value);
    const onCycle = state.reach.reaches(holder.node, holder.node);
    if (
      (closes || onCycle) &&
      this.#reachesDisposable(state, closes ? value : holder.node, value)
    ) {
      // The cycle's types are found only where findings are made: the fixed point needs none.
      if (this.recording) {
        const cycle = closes
          ? cycleOf(this, state, holder, value)
          : cycleOf(this, state, { ...holder, exact: true }, holder.node);
        this.violate('write', site, cycle, undefined);
      }
    } else if (!closes) {
      this.lift(state, holder.node, value, { holderType: holder.type, kind: 'reach' });
    }
    this.link(state, holder, value, false);
  }

  /**
   * Whether what `from` and `value` hold may reach a disposable, as the values they reach say: a
   * closure this body made and a captured `let`'s cell say only what they hold, so a cycle of
   * closures and cells holding nothing else, `let f = fn: f()`, holds none (design.md §1).
   */
  #reachesDisposable(state: FlowState, from: NodeId, value: NodeId): boolean {
    const held = [from, value].flatMap((node) => [
      node,
      ...state.reach.reachedFrom(node),
      ...state.reach.aliasesOf(node),
    ]);
    return held.some(
      (node) =>
        this.nodes.isRelevant(node) &&
        !this.nodes.isCellNode(node) &&
        state.callees.get(node)?.kind !== 'closure',
    );
  }

  /**
   * What reaches `holder` comes to reach `value` (or only what it reaches, `inside`), written into
   * its cell, or, not `exact`, into one it reaches.
   */
  link(state: FlowState, holder: Written, value: NodeId, inside: boolean): void {
    state.reach.link(holder.node, value, { exact: holder.exact, inside });
    this.endPathsThrough(state, holder);
  }

  /**
   * The requirements on this function's callers that `value` not come to reach `holder` would
   * put: one on each pair of inputs, the one sharing with `value`, the other reaching or holding
   * `holder`.
   */
  lift(
    state: FlowState,
    holder: NodeId,
    value: NodeId,
    {
      holderType,
      valueType = this.nodes.typeOf(value),
      kind,
      lands = 'behind',
    }: {
      readonly holderType: Type;
      readonly valueType?: Type | undefined;
      readonly kind: Requirement['kind'];
      readonly lands?: Requirement['lands'];
    },
  ): void {
    if (!this.recording) {
      return;
    }
    for (const pair of this.liftedPairs(state, holder, value, kind)) {
      this.require({ kind, ...pair, holderType, valueType, lands, label: anyField });
    }
  }

  /**
   * The pairs of inputs a write of `value` into `holder` (or, `share`, their separation) would
   * require apart: the one sharing with `value`, the other reaching or holding `holder`.
   */
  liftedPairs(
    state: FlowState,
    holder: NodeId,
    value: NodeId,
    kind: Requirement['kind'],
  ): readonly InputPair[] {
    // What a watching handle may give relates by types where a call gives it: a write of it that
    // may close a cycle is found there, not lifted.
    const candidates = candidatesIn(this, state).filter(({ input }) => input.kind !== 'watched');
    const sources = candidates.filter(({ node }) => state.reach.carriedBy(value, node));
    const holders = candidates.filter(({ node }) =>
      kind === 'share'
        ? state.reach.shares(holder, node)
        : node === holder || state.reach.closes(holder, node) || state.reach.reaches(node, holder),
    );
    return sources.flatMap((source) =>
      holders
        .filter(({ input }) => apart(input, source.input))
        .map((target) => ({ holder: target.input, value: source.input })),
    );
  }

  /**
   * The input a call of `callee` calls, where it is a function value this function was given and
   * calls as it was, which its caller may know (design.md §5.4); noted as called.
   */
  calledInput(state: FlowState, callee: NodeId): Input | undefined {
    const named = this.canonOf(state, callee);
    const slot = this.nodes.inputs.find(
      (each) => each.value === named && each.input.kind !== 'cell' && each.input.kind !== 'global',
    );
    if (slot !== undefined && this.recording) {
      this.calls.set(inputKey(slot.input), slot.input);
    }
    return slot?.input;
  }

  /** The node an input is known by: as given, or a reference parameter's own, its caller's place. */
  inputNodeOf(slot: Nodes['inputs'][number]): NodeId {
    return this.references.has(slot.value) ? slot.value : slot.node;
  }

  /** Notes `requirement`; two alike but for what is written require it of any value. */
  require(requirement: Requirement): void {
    const { keyOf } = this.context.facts;
    const key = `${requirement.kind}|${requirement.lands}|${inputKey(requirement.holder)}|${inputKey(requirement.value)}|${keyOf(requirement.holderType)}`;
    const known = this.requirements.get(key);
    if (known === undefined) {
      this.requirements.set(key, requirement);
    } else if (
      known.valueType !== undefined &&
      (requirement.valueType === undefined ||
        keyOf(requirement.valueType) !== keyOf(known.valueType))
    ) {
      this.requirements.set(key, { ...known, valueType: undefined });
    }
  }

  /**
   * Notes `cycle` closing at `site`: reported where a disposable is surely on it, else the
   * function's always, where its instantiation may close it.
   */
  violate(
    kind: Violation['kind'],
    site: NodeOf<string>,
    cycle: TypedCycle,
    callee: FunctionDeclaration | undefined,
  ): void {
    if (!this.recording) {
      return;
    }
    const { keyOf } = this.context.facts;
    const relevance = cycleRelevance(this.context.facts, cycle);
    if (relevance === 'yes') {
      const holderType = cycle.deciding;
      const at = this.violations.get(site) ?? new Map<string, Violation>();
      this.violations.set(site, at);
      if (!at.has(`${kind}:${keyOf(holderType)}`)) {
        at.set(`${kind}:${keyOf(holderType)}`, { kind, site, holderType, callee });
      }
    } else if (relevance === 'depends') {
      const key = [cycle.kind, cycle.holder, cycle.deciding, ...cycle.through]
        .map((each) => (typeof each === 'string' ? each : keyOf(each)))
        .join('|');
      if (!this.always.has(key)) {
        this.always.set(key, cycle);
      }
    }
  }

  /** `node` and what it holds are handed to code nobody sees, and so are the inputs it shares. */
  leak(state: FlowState, node: NodeId): void {
    if (!state.reach.isLive(node)) {
      return;
    }
    if (this.recording) {
      for (const slot of this.nodes.inputs) {
        if (state.reach.shares(node, this.inputNodeOf(slot))) {
          this.leaks.set(inputKey(slot.input), slot.input);
        }
      }
    }
    state.reach.escape(node);
  }

  /** Runs code nobody sees (unseen.ts): other executions, or the code `call` runs. */
  runUnseen(state: FlowState, call?: UnseenCall): void {
    runUnseen(this, state, call);
  }

  /** The relevance of `type`, the more of it and `other`'s. */
  relevance(type: Type, other?: Type): Relevance {
    const own = this.nodes.relevanceOf(type);
    return other === undefined ? own : moreRelevant(own, this.nodes.relevanceOf(other));
  }
}

/**
 * After `value` is written into a place `holder`'s own cell holds, the variable `place` naming that
 * place's value holds it too: a captured `let` is its cell's value and a variable at once.
 */
export function placeHolds(state: FlowState, holder: Written, place: NodeId, value: NodeId): void {
  if (place !== holder.node && holder.exact) {
    state.reach.contain(place, value);
  }
}
