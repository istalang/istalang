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
import type { FunctionCall } from '../../../surface/resolved-call.ts';
import { isHandleType } from '../../../types/properties/handles.ts';
import type { Type } from '../../../types/type/index.ts';
import type { FlowFunction, ValueId } from '../../flow/flow-ir.ts';
import type { NodeId } from '../reach-state.ts';
import { anyField, type Input, inputKey, type Requirement, type Summary } from '../summary.ts';
import {
  type HandleReach,
  mayAlias,
  mayReach,
  mayShare,
  moreRelevant,
  type Relevance,
} from '../type-reach.ts';
import type { FlowState } from './flow-state.ts';
import type { Nodes, TypeFacts } from './nodes.ts';

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
}

/** Where a cycle may close in this function's text (`LifetimeFinding`, the function aside). */
export type Violation = Omit<LifetimeFinding, 'function'>;

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
  #recording = false;
  unseen = false;

  constructor(
    nodes: Nodes,
    context: AnalysisContext,
    references: ReadonlySet<ValueId>,
    analyzeNested: BodyAnalysis['analyzeNested'],
  ) {
    this.nodes = nodes;
    this.context = context;
    this.references = references;
    this.analyzeNested = analyzeNested;
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
    } else {
      state.reach.fresh(variable);
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
        this.#endPath(state, path);
      }
    }
    for (const [value, named] of state.canon) {
      if (named === root) {
        state.canon.delete(value);
      }
    }
  }

  #endPath(state: FlowState, path: NodeId): void {
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
      this.#endPath(state, path);
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
      this.violate('write', site, this.holderTypeOf(holder.type, value), undefined);
    } else if (!closes) {
      this.lift(state, holder.node, value, holder.type);
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

  /** The more relevant of a holder's type and the value written: the cycle holds both. */
  holderTypeOf(holderType: Type, value: NodeId): Type {
    const valueType = this.nodes.typeOf(value);
    return valueType !== undefined &&
      this.nodes.relevanceOf(valueType) === 'yes' &&
      this.nodes.relevanceOf(holderType) !== 'yes'
      ? valueType
      : holderType;
  }

  /**
   * The requirements on this function's callers that `value` not come to reach `holder` would
   * put: one on each pair of inputs, the one sharing with `value`, the other reaching or holding
   * `holder`.
   */
  lift(state: FlowState, holder: NodeId, value: NodeId, holderType: Type): void {
    if (!this.recording) {
      return;
    }
    const inputs = this.nodes.inputs.filter((slot) => state.reach.isLive(this.inputNodeOf(slot)));
    const sources = inputs.filter((slot) => state.reach.shares(value, this.inputNodeOf(slot)));
    const holders = inputs.filter((slot) => {
      const node = this.inputNodeOf(slot);
      return (
        node === holder || state.reach.closes(holder, node) || state.reach.reaches(node, holder)
      );
    });
    for (const source of sources) {
      for (const target of holders) {
        if (inputKey(source.input) !== inputKey(target.input)) {
          this.require({ holder: target.input, value: source.input, holderType, label: anyField });
        }
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
    const key = `${inputKey(requirement.holder)}|${inputKey(requirement.value)}|${this.context.facts.keyOf(requirement.holderType)}`;
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

  /**
   * Code nobody sees runs (design.md §5.5): what is escaped may come to reach each other as the
   * declaration graph allows, so does what reaches those, and the paths through them may change.
   * Other executions run only where this one suspends; an async call suspends long after its
   * caller called it, so only a call of unseen code made before returning (`calls`) makes its
   * summary `unseen`.
   */
  runUnseen(state: FlowState, calls = false): void {
    if (calls) {
      this.unseen = true;
    }
    const reached = state.reach
      .escaped()
      .filter((node) => this.nodes.isRelevant(node) && state.reach.isLive(node));
    const live = new Set(reached);
    for (const path of this.nodes.allPaths()) {
      const read = this.nodes.pathOf(path);
      if (read?.kind === 'through' && state.reach.isLive(path) && live.has(read.root)) {
        this.#endPath(state, path);
      }
    }
    this.#closeOver(
      state,
      [...live].filter((node) => state.reach.isLive(node)),
    );
  }

  /**
   * Whether two handles may be one object: then neither can come to reach the other but through a
   * cycle, which none may pass through (design.md §1).
   */
  #oneHandle(state: FlowState, first: NodeId, second: NodeId): boolean {
    const types = [this.nodes.typeOf(first), this.nodes.typeOf(second)];
    return (
      state.reach.aliases(first, second) &&
      types.every((type) => type !== undefined && isHandleType(type))
    );
  }

  /** What `live` may come to reach of each other, and what reaches them comes to reach too. */
  #closeOver(state: FlowState, live: readonly NodeId[]): void {
    const reaches = live.map((node) => [node, this.nodes.reachOf(node)] as const);
    for (const [index, [first, firstReach]] of reaches.entries()) {
      for (const [second, secondReach] of reaches.slice(index + 1)) {
        if (
          firstReach !== undefined &&
          secondReach !== undefined &&
          !this.#oneHandle(state, first, second)
        ) {
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

  /** Whether a value of `value`'s type may come to reach or be one of `holder`'s. */
  typesClose(holder: Type, value: Type): boolean {
    const holderReach = this.context.facts.reachOf(holder);
    const valueReach = this.context.facts.reachOf(value);
    return mayReach(valueReach, holderReach) || mayAlias(valueReach, holderReach);
  }

  /** The relevance of `type`, the more of it and `other`'s. */
  relevance(type: Type, other?: Type): Relevance {
    const own = this.nodes.relevanceOf(type);
    return other === undefined ? own : moreRelevant(own, this.nodes.relevanceOf(other));
  }
}

/** Relates two nodes as the declaration graph says values of their types may come to be. */
function relateByTypes(
  state: FlowState,
  [first, firstReach]: readonly [NodeId, HandleReach],
  [second, secondReach]: readonly [NodeId, HandleReach],
): void {
  if (mayReach(firstReach, secondReach)) {
    state.reach.addReach(first, second);
  }
  if (mayReach(secondReach, firstReach)) {
    state.reach.addReach(second, first);
  }
  if (mayAlias(firstReach, secondReach)) {
    state.reach.addAlias(first, second);
  } else if (mayShare(firstReach, secondReach)) {
    state.reach.addShare(first, second);
  }
}
