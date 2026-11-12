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
import type { LifetimeFinding, SignatureParameter } from '../../../check.ts';
import type { FunctionCall, RequirementCall } from '../../../surface/resolved-call.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowFunction, ValueId } from '../../flow/flow-ir.ts';
import { decidingType } from '../escaping.ts';
import type { NodeId } from '../reach-state.ts';
import { anyField, type Input, inputKey, type Requirement, type Summary } from '../summary.ts';
import { lessRelevant, moreRelevant, type Relevance } from '../type-reach.ts';
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
   * What a call through an `any` value may run: each witness of the required function among the
   * types the program puts into an `any` of its trait; undefined for a call through anything else.
   */
  readonly dispatched: (call: RequirementCall) => readonly FunctionCall[] | undefined;
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
  readonly always = new Map<string, Type>();
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
    nesting: { readonly analyze: BodyAnalysis['analyzeNested']; readonly separates: boolean },
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
      this.violate('write', site, this.holderTypeOf(state, holder, value), undefined);
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
    state.reach.link(holder.node, value, inside);
    this.endPathsThrough(state, holder);
  }

  /**
   * The type deciding a cycle closed by writing `value` into `holder`, of `holderType`. Each path
   * the value may reach the holder by holds a disposable only where every value on it may reach
   * one, so a path through a value of a type parameter's type is decided by its instantiation; the
   * surest path decides (`cyclePath`).
   */
  holderTypeOf(state: FlowState, { node: holder, type: holderType }: Holder, value: NodeId): Type {
    const path = this.#pathType(state, holder, value);
    return path === undefined ? holderType : this.decidingType(holderType, path);
  }

  /**
   * The least relevant type on the surest path from `value` to `holder`: through the parts of a
   * value this body made where it has them, each a path of its own, else through what it reaches.
   */
  #pathType(state: FlowState, holder: NodeId, value: NodeId): Type | undefined {
    const valueType = this.nodes.typeOf(value);
    if (valueType === undefined) {
      return undefined;
    }
    const parts = this.nodes
      .pathsFrom(value)
      .filter((path) => this.nodes.pathOf(path)?.kind === 'part' && state.reach.isLive(path));
    if (parts.length > 0) {
      const closing = parts
        .filter((path) => state.reach.closes(holder, path))
        .flatMap((path) => this.#pathType(state, holder, path) ?? []);
      const most = closing.reduce<Type | undefined>(
        (found, type) =>
          found === undefined ||
          lessRelevant(this.nodes.relevanceOf(found), this.nodes.relevanceOf(type))
            ? type
            : found,
        undefined,
      );
      return most === undefined ? valueType : this.decidingType(valueType, most);
    }
    const sure = cyclePath(this.nodes, state, { from: value, to: holder, least: 'yes' });
    return (
      sure ??
      cyclePath(this.nodes, state, { from: value, to: holder, least: 'depends' }) ??
      valueType
    );
  }

  /**
   * Of a cycle's holder's and value's types, the one deciding whether it may hold a disposable:
   * the value reaches the holder on it, so it holds one only where both types may reach one, and a
   * value of a type parameter's type only where its instantiation may (design.md §5.3).
   */
  decidingType(holderType: Type, valueType: Type): Type {
    return decidingType(this.context.facts, holderType, valueType);
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
    { holderType, kind }: { readonly holderType: Type; readonly kind: Requirement['kind'] },
  ): void {
    if (!this.recording) {
      return;
    }
    const candidates = candidatesIn(this, state);
    const sources = candidates.filter(({ node }) => state.reach.shares(value, node));
    const holders = candidates.filter(({ node }) =>
      kind === 'share'
        ? state.reach.shares(holder, node)
        : node === holder || state.reach.closes(holder, node) || state.reach.reaches(node, holder),
    );
    for (const source of sources) {
      for (const target of holders.filter(({ input }) => apart(input, source.input))) {
        this.require({
          kind,
          holder: target.input,
          value: source.input,
          holderType,
          label: anyField,
        });
      }
    }
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

  require(requirement: Requirement): void {
    const key = `${requirement.kind}|${inputKey(requirement.holder)}|${inputKey(requirement.value)}|${this.context.facts.keyOf(requirement.holderType)}`;
    if (!this.requirements.has(key)) {
      this.requirements.set(key, requirement);
    }
  }

  /** Notes a cycle closing at `site`: reported where a disposable is surely on it, else lifted. */
  violate(
    kind: Violation['kind'],
    site: NodeOf<string>,
    holderType: Type,
    callee: FunctionDeclaration | undefined,
  ): void {
    if (!this.recording) {
      return;
    }
    const relevance: Relevance = this.nodes.relevanceOf(holderType);
    const key = this.context.facts.keyOf(holderType);
    if (relevance === 'yes') {
      const at = this.violations.get(site) ?? new Map<string, Violation>();
      this.violations.set(site, at);
      if (!at.has(`${kind}:${key}`)) {
        at.set(`${kind}:${key}`, { kind, site, holderType, callee });
      }
    } else if (relevance === 'depends' && !this.always.has(key)) {
      this.always.set(key, holderType);
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
 * The least relevant type on a path from `from` to what reaches or is `to`, by what each value
 * reaches or holds, through values at least `least` relevant; undefined where there is none.
 */
function cyclePath(
  nodes: Nodes,
  state: FlowState,
  { from, to, least }: { readonly from: NodeId; readonly to: NodeId; readonly least: Relevance },
): Type | undefined {
  const allowed = (node: NodeId) => {
    const type = nodes.typeOf(node);
    return type !== undefined && !lessRelevant(nodes.relevanceOf(type), least);
  };
  const leastOf = new Map<NodeId, Type>();
  const pending = allowed(from) ? [from] : [];
  const typeOf = (node: NodeId) => nodes.typeOf(node) as Type;
  leastOf.set(from, typeOf(from));
  while (pending.length > 0) {
    const node = pending.shift() as NodeId;
    const found = leastOf.get(node) as Type;
    if (node === to || state.reach.closes(to, node)) {
      return found;
    }
    for (const next of [...state.reach.reachedFrom(node), ...state.reach.aliasesOf(node)]) {
      if (!leastOf.has(next) && allowed(next)) {
        const type = typeOf(next);
        leastOf.set(
          next,
          lessRelevant(nodes.relevanceOf(type), nodes.relevanceOf(found)) ? type : found,
        );
        pending.push(next);
      }
    }
  }
  return undefined;
}
