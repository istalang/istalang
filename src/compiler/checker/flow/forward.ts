/**
 * Forward data flow over a body (§3.15, §4, §7, §8): the one model of the order its code runs in.
 * A rule's state flows through the body as the code runs, joining where paths meet, around a loop
 * until what reaches its top stops growing, and nowhere past a `return`, `break` or `continue`.
 * A rule gives its states and what a name, a whole assignment and a `drop` do to one; only this
 * module knows how each construct runs.
 *
 * - Every expression and statement kind says how it runs, in a table exhaustive by type, so a new
 *   construct can't flow as straight-line code unnoticed. A part (a branch, a case, an item) runs
 *   only as its construct runs it; parts run their children in source order. A statement's
 *   annotations never run.
 * - A lambda or local function runs its body when it is called, not where it is made (syntax
 *   `nestsFunction`); but it captures what it uses where it is made, so its body flows from the
 *   state there, as a flow of its own whose end goes nowhere.
 * - `break` and `continue` leave the loop the checker found for them (`CheckedBody.labels`); a
 *   labelled block runs as a block.
 * - `and`, `or` and `??` run their right side only sometimes, and so does whatever follows a `?.`
 *   in an optional chain (§4): both paths join after. `e?` may return, which ends that path.
 * - An assignment runs its value first, then assigns its parts left to right (§3.15), a compound
 *   one reading its place first; a name assigned whole is written, not read. A declaration runs
 *   its initializer before its targets declare their names, and a comprehension runs as a loop.
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { chainStepOf, isOptionallyChained } from '../../syntax/expressions/chains.ts';
import type {
  Expression,
  MatchCase,
  SelectCase,
  StructComprehension,
} from '../../syntax/expressions/index.ts';
import { casesOf, selectCasesOf, unparenthesized } from '../../syntax/expressions/readings.ts';
import type { Identifier } from '../../syntax/node.ts';
import { binaryOperators } from '../../syntax/operators.ts';
import {
  type Assignment,
  type Block,
  type Break,
  type Continue,
  type Drop,
  type OverFields,
  passedParts,
  type Statement,
  targetParts,
} from '../../syntax/statements.ts';
import { fieldChildrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { LabelResolution } from '../surface/checked-body.ts';
import { partsBeside } from './chain-parts.ts';

/** What a flow rule decides: its states, where paths meet, and what its own events do. */
export interface FlowRule<State> {
  /** What reaches a point where paths meet, from what each path brings. */
  readonly join: (states: readonly State[]) => State;
  /** Whether `later`, joined over `earlier`, holds nothing more: a loop's top has settled. */
  readonly settled: (earlier: State, later: State) => boolean;
  /** A name run: a use of what it names, or the name declaring its variable. */
  readonly name?: (name: Identifier, state: State) => State;
  /** A name assigned whole, `x = v`, once its value has run. */
  readonly assign?: (name: Identifier, state: State) => State;
  /** A `drop`, once its value has run. */
  readonly drop?: (node: Drop, state: State) => State;
}

/** A body a walk runs, and what the walk needs to know of it beyond its syntax. */
export interface FlowBody {
  readonly root: SyntaxNode;
  /** Which loop each `break` and `continue` leaves. */
  readonly labels: LabelResolution;
  /** The body of each local function the body declares, which its tree holds apart. */
  readonly bodyOf: (declaration: FunctionDeclaration) => Block | undefined;
}

/** What reaches the end of `body`, run from `state`; undefined when no path does. */
export function flowThrough<State extends Opaque>(
  rule: FlowRule<State>,
  body: FlowBody,
  state: State,
): State | undefined {
  // The walk hands the rule only states the rule made, so it carries them unlooked-into.
  const walk = new FlowWalk(rule as unknown as FlowRule<Opaque>, body);
  return walk.function(body.root, state) as State | undefined;
}

/** A rule's state, as the walk carries it: never undefined, which marks a point no path reaches. */
type Opaque = NonNullable<unknown>;

/** What reaches a point: a rule's state, or undefined where no path does. */
type Flow = Opaque | undefined;

/** What reaches `loop`'s exits: after its body's `break`s, and its top again after `continue`s. */
interface LoopExits {
  readonly loop: SyntaxNode;
  readonly breaks: Opaque[];
  readonly continues: Opaque[];
}

/** The kinds that say how they run; any other node is a part, run as its construct says. */
type Construct = Expression | Statement | Block | StructComprehension;

class FlowWalk {
  readonly #rule: FlowRule<Opaque>;
  readonly #labels: LabelResolution;
  readonly bodyOf: FlowBody['bodyOf'];
  #loops: LoopExits[] = [];

  constructor(rule: FlowRule<Opaque>, { labels, bodyOf }: FlowBody) {
    this.#rule = rule;
    this.#labels = labels;
    this.bodyOf = bodyOf;
  }

  /** Runs a function's body from `state`, its loops its own. */
  function(body: SyntaxNode, state: Opaque): Flow {
    const outer = this.#loops;
    this.#loops = [];
    const end = this.node(body, state);
    this.#loops = outer;
    return end;
  }

  /** What reaches the end of `node`, run from `state`. */
  node(node: SyntaxNode, state: Opaque): Flow {
    if (!isConstruct(node)) {
      return this.sequence(fieldChildrenOf(node), state);
    }
    return handlerOf(constructs, node)(this, node, state);
  }

  /** Runs `nodes` one after another. */
  sequence(nodes: readonly SyntaxNode[], state: Flow): Flow {
    let flow = state;
    for (const node of nodes) {
      if (flow === undefined) {
        return undefined;
      }
      flow = this.node(node, flow);
    }
    return flow;
  }

  /** Runs `nodes` after `state`, or not at all: what reaches either way. */
  sometimes(nodes: readonly SyntaxNode[], state: Flow): Flow {
    return this.join([state, this.sequence(nodes, state)]);
  }

  join(flows: readonly Flow[]): Flow {
    const reaching = flows.filter((flow) => flow !== undefined);
    return reaching.length === 0 ? undefined : this.#rule.join(reaching);
  }

  name(name: Identifier, state: Opaque): Opaque {
    return this.#rule.name?.(name, state) ?? state;
  }

  drop(node: Drop, state: Flow): Flow {
    return state && (this.#rule.drop?.(node, state) ?? state);
  }

  /** `exit` to the loop it leaves: past its end, or to its top again. */
  exit(exit: Break | Continue, state: Opaque): undefined {
    const target = this.#labels.exitOf(exit);
    const loop = this.#loops.findLast((each) => each.loop === target);
    loop?.[exit.kind === 'Break' ? 'breaks' : 'continues'].push(state);
  }

  /**
   * `loop`: `pass` runs one pass from what reaches the top, giving what leaves it normally and what
   * reaches the end of its body. Passes repeat until what reaches the top has settled.
   */
  loop(
    loop: SyntaxNode,
    state: Flow,
    pass: (top: Opaque) => { readonly exit: Flow; readonly end: Flow },
  ): Flow {
    if (state === undefined) {
      return undefined;
    }
    let top = state;
    for (;;) {
      const exits: LoopExits = { loop, breaks: [], continues: [] };
      this.#loops.push(exits);
      const { exit, end } = pass(top);
      this.#loops.pop();
      const next = this.join([top, end, ...exits.continues]) ?? top;
      if (this.#rule.settled(top, next)) {
        return this.join([exit, ...exits.breaks]);
      }
      top = next;
    }
  }

  /**
   * An assignment: a compound one's place read, its value, then each target: a name assigned
   * whole is written; any other place is read to reach the part it writes.
   */
  assignment(node: Assignment, state: Opaque): Flow {
    const read = node.operator === '=' ? state : this.sequence(node.targets, state);
    const assign = (flow: Flow, target: Expression): Flow => {
      const parts = targetParts(target);
      if (flow === undefined || parts.length > 0) {
        return parts.reduce(assign, flow);
      }
      const bare = unparenthesized(target);
      return bare.kind === 'Identifier'
        ? (this.#rule.assign?.(bare, flow) ?? flow)
        : this.node(bare, flow);
    };
    return node.targets.reduce(assign, this.sequence([node.value], read));
  }

  /** An `if`: each condition runs when the ones before failed; one body, or none, runs. */
  conditional(
    branches: readonly { readonly condition: SyntaxNode; readonly body: SyntaxNode }[],
    otherwise: SyntaxNode | undefined,
    state: Opaque,
  ): Flow {
    const ends: Flow[] = [];
    let failed: Flow = state;
    for (const { condition, body } of branches) {
      const tested = this.sequence([condition], failed);
      ends.push(this.sequence([body], tested));
      failed = tested;
    }
    ends.push(otherwise === undefined ? failed : this.sequence([otherwise], failed));
    return this.join(ends);
  }

  /** A `match`: its subject, then each case's pattern and guard until one holds, and its body. */
  match(subject: SyntaxNode, cases: readonly MatchCase[], state: Opaque): Flow {
    const ends: Flow[] = [];
    let failed = this.node(subject, state);
    for (const { pattern, guard, body } of cases) {
      const tested = this.sequence(guard === undefined ? [pattern] : [pattern, guard], failed);
      ends.push(this.sequence([body], tested));
      failed = this.join([failed, tested]);
    }
    return this.join(ends);
  }

  /** A `select`: every case's future, then one case's body, or the `else` (§8). */
  select(cases: readonly SelectCase[], otherwise: SyntaxNode | undefined, state: Opaque): Flow {
    const evaluated = this.sequence(
      cases.map((each) => each.future),
      state,
    );
    const ends = cases.map((each) =>
      this.sequence(
        each.binding === undefined ? [each.body] : [each.binding, each.body],
        evaluated,
      ),
    );
    return this.join(
      otherwise === undefined ? ends : [...ends, this.sequence([otherwise], evaluated)],
    );
  }

  /**
   * `node`, a link of a chain when syntax gives it a step (`chainStepOf`): its step's target, then
   * the rest of its parts, run only when no `?.` or `?->` before it in the chain met `none` (§4).
   */
  link(node: Expression, state: Opaque) {
    const step = chainStepOf(node);
    if (step === undefined) {
      return this.sequence(fieldChildrenOf(node), state);
    }
    const reached = this.node(step.target, state);
    const parts = partsBeside(node, step.target);
    return isOptionallyChained(node)
      ? this.sometimes(parts, reached)
      : this.sequence(parts, reached);
  }
}

/** A construct whose parts run in source order. */
/**
 * A construct running over a struct's fields (§4): its header's subject once, then its key and
 * value and what its passes check once per field, which may be never.
 */
function overFields(walk: FlowWalk, node: OverFields, state: Opaque): Flow {
  const { header } = node;
  return walk.loop(node, walk.node(header.subject, state), (top) => ({
    exit: top,
    end: walk.sequence([header.key, header.value, ...passedParts(node)], top),
  }));
}

function children(walk: FlowWalk, node: SyntaxNode, state: Opaque): Flow {
  return walk.sequence(fieldChildrenOf(node), state);
}

/** A construct that may be a link of an optional chain. */
function link(walk: FlowWalk, node: Expression, state: Opaque): Flow {
  return walk.link(node, state);
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const constructs: Handlers<FlowWalk, Construct, [Opaque], Flow> = {
  Identifier: (walk, node, state) => walk.name(node, state),
  IntegerLiteral: children,
  FloatLiteral: children,
  DurationLiteral: children,
  StringLiteral: children,
  BooleanLiteral: children,
  NoneLiteral: children,
  ArrayLiteral: children,
  MapLiteral: children,
  Comprehension: (walk, node, state) =>
    walk.loop(node, walk.node(node.iterable, state), (top) => ({
      exit: top,
      end: walk.sequence(
        [...node.targets, ...(node.condition === undefined ? [] : [node.condition]), node.body],
        top,
      ),
    })),
  FieldComprehension: overFields,
  StructComprehension: overFields,
  Tuple: children,
  Parenthesized: children,
  StructLiteral: children,
  NewStructLiteral: children,
  IndentedValue: children,
  Lambda: (walk, node, state) => {
    walk.function(node.body, state);
    return state;
  },
  Call: link,
  Reference: children,
  MemberAccess: link,
  TupleElement: link,
  Index: link,
  Propagate: children,
  Unwrap: children,
  Spawn: (walk, node, state) => walk.node(node.call, state),
  TemplateLiteral: children,
  ChainedComparison: (walk, node, state) => {
    // Each comparison after the first runs only when the ones before it held.
    const first = walk.sequence(node.operands.slice(0, 2), state);
    return walk.sometimes(node.operands.slice(2), first);
  },
  Dereference: link,
  Unary: children,
  Await: children,
  Binary: (walk, node, state) => {
    const left = walk.node(node.left, state);
    const { kind } = binaryOperators[node.operator].meaning;
    const sometimes = kind === 'logic' || kind === 'coalesce';
    return sometimes ? walk.sometimes([node.right], left) : walk.sequence([node.right], left);
  },
  Is: children,
  Range: children,
  BlockExpression: children,
  If: (walk, node, state) => walk.conditional(node.branches, node.elseClause?.body, state),
  Match: (walk, node, state) => walk.match(node.subject, casesOf(node), state),
  Select: (walk, node, state) => walk.select(selectCasesOf(node), node.elseClause?.body, state),
  Missing: (_, __, state) => state,
  Invalid: (_, __, state) => state,
  Block: children,
  ExpressionStatement: (walk, node, state) => walk.node(node.expression, state),
  VariableDeclaration: (walk, node, state) =>
    walk.sequence(node.targets, walk.node(node.initializer, state)),
  FunctionDeclaration: (walk, node, state) => {
    const body = walk.bodyOf(node);
    if (body !== undefined) {
      walk.function(body, state);
    }
    return state;
  },
  Assignment: (walk, node, state) => walk.assignment(node, state),
  Return: (walk, node, state) => {
    walk.sequence(node.value === undefined ? [] : [node.value], state);
  },
  Break: (walk, node, state) => walk.exit(node, state),
  Continue: (walk, node, state) => walk.exit(node, state),
  For: (walk, node, state) =>
    walk.loop(node, walk.node(node.iterable, state), (top) => ({
      exit: top,
      end: walk.sequence([...node.targets, node.body], top),
    })),
  FieldLoop: overFields,
  While: (walk, node, state) =>
    walk.loop(node, state, (top) => {
      const tested = walk.node(node.condition, top);
      return { exit: tested, end: walk.sequence([node.body], tested) };
    }),
  LabelledBlock: (walk, node, state) => walk.node(node.body, state),
  Defer: (walk, node, state) => walk.node(node.action, state),
  Drop: (walk, node, state) => walk.drop(node, walk.node(node.value, state)),
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

function isConstruct(node: SyntaxNode): node is Construct {
  return Object.hasOwn(constructs, node.kind);
}
