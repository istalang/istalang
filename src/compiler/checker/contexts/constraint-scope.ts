/**
 * A constraint scope (docs/work/variance-inference/i2-scope.md): the one system of variables the
 * generic calls and literals of an outermost expression infer in, the members that joined it, and
 * the records waiting for it to settle. The body context holds the current one
 * (wiring/body/body-checker.ts); the call that opened it settles it on every path, so no member is
 * ever left unsettled.
 *
 * - A member's inference lives in the scope's system (`root`): a literal's from the start, a call's
 *   once its candidate is chosen and it joins (`Inference.commitTo`); the first member's system is
 *   the scope's, so a scope one call alone joins builds none. So what a member is given and gives bounds
 *   the very variables everything else in the scope sees, and no construct reads another's variables
 *   through its own parameters.
 * - An expression that needs what is expected of it to be checked (a lambda, a function or variant
 *   named as a value) is a placeholder member, a variable standing for its type (i2-scope.md §3).
 *   What it can't be a value of, it refuses as a bound, so a candidate a call probes that gives it
 *   one fails. The scope checks it once what is expected of it is known enough: its head, and for a
 *   function its inputs, which no other placeholder still gives, settled then; each ready one
 *   first, then in the order they joined, one never ready with what is known. What it then is, its
 *   placeholder is taken as.
 * - Settling judges every placeholder, those joining while that runs included, then solves every
 *   variable together, writes each record that waited, solved, and completes each member in the
 *   order they joined, what it was given before it. One pass writes every record.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Admits } from '../types/fitting/expected.ts';
import { expectedFunction } from '../types/fitting/expected.ts';
import { Inference } from '../types/inference/infer.ts';
import type { Settling, SettlingOf } from '../types/inference/settle.ts';
import type { Type } from '../types/type/index.ts';
import { membersOf } from '../types/unions/unions.ts';

/**
 * Whether `node` is checked in the current scope (i2-scope.md §2): a call; a struct, array, map or
 * tuple literal, or an indented value; a branching expression's or a block's value; maybe
 * parenthesized. Any other kind is a boundary, whose parts each settle on their own; what reads a
 * part of a joining kind settled (a callee, a receiver, a condition, a statement) suspends the scope
 * for it. An expression the scope may postpone (constructs/expressions/postponed.ts) joins too.
 */
export function joinsScope(node: Expression): boolean {
  switch (node.kind) {
    case 'Parenthesized':
      return joinsScope(node.expression);
    case 'Call':
    case 'NewStructLiteral':
    case 'StructLiteral':
    case 'ArrayLiteral':
    case 'MapLiteral':
    case 'Tuple':
    case 'IndentedValue':
    case 'If':
    case 'Match':
    case 'Select':
    case 'BlockExpression':
      return true;
    default:
      return false;
  }
}

/**
 * Whether `node`, checked where no scope is open, opens one: any kind that joins a scope does, so an
 * expression infers alike wherever it stands, at the top of a statement or passed to a call; but an
 * indented value naming no type, which only what it goes into decides, and nothing does there.
 */
export function opensScope(node: Expression): boolean {
  switch (node.kind) {
    case 'Parenthesized':
      return opensScope(node.expression);
    case 'IndentedValue':
      return node.type !== undefined;
    default:
      return joinsScope(node);
  }
}

/** A generic call or literal joined to a scope, its inference open until the scope settles. */
export interface ScopeMember {
  /**
   * The node the member is, whose type completing it records; none for a call an operator makes,
   * whose own handler records it.
   */
  readonly node: Expression | undefined;
  /** Its inference, in the scope's system. */
  readonly inference: Inference;
  /** How its type parameters settle where it stands. */
  readonly settling: Settling;
  /** Its value's type, in the scope's variables. */
  readonly type: Type;
  /** Completes it once the scope is solved, recording what it makes; its type then. */
  readonly complete: () => Type;
}

/**
 * An expression the scope checks once it knows what is expected of it (i2-scope.md §3), its type
 * until then its placeholder, a variable of the scope.
 */
export interface PostponedMember {
  readonly node: Expression;
  /** Its placeholder's inference, in the scope's system. */
  readonly inference: Inference;
  /** Its placeholder, as a type. */
  readonly type: Type;
  /** Whether it can be a value of a type, a part open in the scope being anything. */
  readonly admits: Admits;
  /**
   * Whether it has a type of its own where nothing is expected of it, as a `struct{…}`'s shape, so
   * what siblings beside it hold never decides it.
   */
  readonly standsAlone?: boolean | undefined;
  /** Checks it where `expected` is what is known of what is expected of it: its type then. */
  readonly judge: (expected: Type | undefined) => Type;
}

/** A body's constraint scopes, as its checking works through them (wiring/body/body-scopes.ts). */
export interface Scopes {
  /** Whether a scope is current. */
  readonly isOpen: boolean;
  /** The scope current now, for what is checked later to join it (`within`). */
  readonly current: ConstraintScope | undefined;
  /**
   * Runs `check` with `scope` current, as a `return` deep in a lambda's statements checks its value
   * in the scope the lambda's result lives in; with none, with no scope current.
   */
  readonly within: <Result>(scope: ConstraintScope | undefined, check: () => Result) => Result;
  /** Whether `type` mentions a variable of the current scope, open until it settles. */
  readonly holds: (type: Type | undefined) => boolean;
  /**
   * Runs `check` with no scope current, so what it checks settles on its own, as the items of a
   * literal decided by where it goes, which reads their types at once.
   */
  readonly suspended: <Result>(check: () => Result) => Result;
  /**
   * The inference holding the current scope's system, which a generic literal infers in and a
   * call's candidates start from (`Inference.commitTo`); undefined while none is open, or none of
   * its members has joined.
   */
  readonly root: Inference | undefined;
  /**
   * Moves `inference` into the current scope's system, which becomes its own where no member has
   * joined yet, as a literal's does before its items are checked; with none open, does nothing.
   */
  readonly commit: (inference: Inference) => void;
  /**
   * Joins `member` to the current scope, its inference committed to it: its type, open until the
   * scope settles; with none open, settles it at once: its type, settled.
   */
  readonly join: (member: ScopeMember) => Type;
  /**
   * Joins `member` to the current scope, which checks it once it knows what is expected of it: its
   * placeholder, open until then. Only while a scope is open.
   */
  readonly postpone: (member: PostponedMember) => Type;
  /**
   * `type`, open in the current scope, with what is settled in place and, for the rest, what the
   * expected type chooses where settling would take it (settle.ts rule 2): what a lambda's body is
   * guided by.
   */
  readonly guided: (type: Type) => Type;
  /**
   * Gives the error type where each of `types` still open in the current scope goes, those of
   * arguments a call that can't be made took, so variables only that call would have bounded
   * settle to it, reporting nothing more.
   */
  readonly abandon: (types: readonly (Type | undefined)[]) => void;
  /**
   * Runs `check` in a scope of its own, which settles once it is done, as a call continuing an
   * optional chain is checked: the type it gives, settled.
   */
  readonly isolated: (check: () => Type) => Type;
  /**
   * Runs `work` once the current scope is solved, with the scope's types as solved, before its
   * members complete, as a call no candidate takes reports then; with none open, at once.
   */
  readonly whenSolved: (work: (solved: (type: Type) => Type) => void) => void;
  /**
   * Writes a record of `type` again, as `write` does, with it solved once the current scope is,
   * where the scope holds it: a lambda's function, recorded as its body gave it.
   */
  readonly recorded: (type: Type, write: (solved: Type) => void) => void;
}

/** What settling a scope does through the body context. */
export interface ScopeSettling {
  /** Runs `check` with no scope current, so whatever it checks settles on its own. */
  readonly suspended: (check: () => void) => void;
  /** Records `node` as having `type`. */
  readonly record: (node: Expression, type: Type) => void;
}

export class ConstraintScope {
  #root: Inference | undefined;
  readonly #members: ScopeMember[] = [];
  readonly #postponed: PostponedMember[] = [];
  /** What waits for the scope to be solved: records written open, reports of calls not made. */
  readonly #waiting: ((solved: (type: Type) => Type) => void)[] = [];

  /**
   * The inference holding the scope's system, which every member's lives in: the first member's,
   * so a scope only one call joins builds no system of its own; undefined before any joins.
   */
  get root(): Inference | undefined {
    return this.#root;
  }

  /**
   * Moves `inference` into the scope's system (`Inference.commitTo`), which is its own where the
   * scope has none yet.
   */
  commit(inference: Inference): void {
    if (this.#root === undefined) {
      this.#root = inference;
    } else {
      inference.commitTo(this.#root);
    }
  }

  /** Joins `member`, its inference committed to the scope. */
  join(member: ScopeMember): void {
    this.commit(member.inference);
    this.#members.push(member);
  }

  /** Joins `member`, a placeholder its inference infers, committed to the scope. */
  postpone(member: PostponedMember): void {
    this.commit(member.inference);
    this.#postponed.push(member);
  }

  /** `type` as what is settled and what the expected type chooses guide it (`Scopes.guided`). */
  guided(type: Type): Type {
    return this.#root === undefined ? type : this.#root.guidedIn(type, this.#settlingOf());
  }

  /** Runs `work` once the scope is solved, with its types as solved, before its members complete. */
  whenSolved(work: (solved: (type: Type) => Type) => void): void {
    this.#waiting.push(work);
  }

  /** Whether `type` mentions a variable of this scope. */
  holds(type: Type): boolean {
    return this.#root?.mentionsVariables(type) === true;
  }

  /** `type` with the scope's variables as it solved them (`settle`). */
  solved(type: Type): Type {
    return this.#root === undefined ? type : this.#root.solved(type);
  }

  /**
   * Judges every member's postponed arguments while the scope is still current, so what a lambda's
   * body gives joins it; then solves, and completes each member with no scope current.
   */
  settle(through: ScopeSettling): void {
    this.#judgeAll();
    this.#root?.solveJointly(this.#members);
    const solve = (type: Type) => this.solved(type);
    through.suspended(() => {
      for (const write of this.#waiting) {
        write(solve);
      }
      for (const member of this.#members) {
        const type = member.complete();
        if (member.node !== undefined) {
          through.record(member.node, type);
        }
      }
    });
  }

  /**
   * Judges every placeholder, those joining while it runs included: each ready one first, then in
   * the order they joined.
   */
  #judgeAll(): void {
    const judged = new Set<PostponedMember>();
    for (;;) {
      const waiting = this.#postponed.filter((member) => !judged.has(member));
      const next = this.#readyOf(waiting) ?? waiting[0];
      if (next === undefined) {
        return;
      }
      judged.add(next);
      this.#judge(next);
    }
  }

  /**
   * The first of `waiting` ready to be judged; where none is, once what they wait on is fixed by
   * what else bounds it, so a sibling of a type of its own tells them what they are.
   */
  #readyOf(waiting: readonly PostponedMember[]): PostponedMember | undefined {
    const isReady = (member: PostponedMember) => this.#isReady(member, waiting);
    const ready = waiting.find(isReady);
    const fixed =
      ready === undefined &&
      this.#root?.fixToward(
        waiting.map(({ type }) => type),
        this.#settlingOf(),
      ) === true;
    return fixed ? waiting.find(isReady) : ready;
  }

  /** Checks `member` with what is known of what is expected of it, its placeholder taken as that. */
  #judge(member: PostponedMember): void {
    const root = this.#root;
    const expectation = this.#expectationOf(member);
    const shape = expectedFunction(expectation);
    if (root !== undefined && shape !== undefined) {
      root.fixIn(inputsOf(shape), this.#settlingOf());
    }
    const expected =
      expectation === undefined || root === undefined ? undefined : root.fixedIn(expectation);
    const judgedType = member.judge(expected);
    // One judged in error gives the error type where it goes, so what it would have bounded
    // settles to it, reporting nothing more.
    if (judgedType.kind === 'error') {
      member.inference.abandon(member.type);
    }
    member.inference.settleAs(member.type, judgedType);
  }

  /**
   * Whether enough is known of what `member` is expected to be: its head; and for a function, its
   * inputs, none of which is what another of `waiting` gives.
   */
  #isReady(member: PostponedMember, waiting: readonly PostponedMember[]): boolean {
    const root = this.#root;
    const expectation = this.#expectationOf(member);
    if (
      root === undefined ||
      expectation === undefined ||
      (expectation.kind === 'parameter' && root.mentionsVariables(expectation))
    ) {
      return false;
    }
    const shape = expectedFunction(expectation);
    if (shape === undefined) {
      return true;
    }
    const inputs = root.openIn(inputsOf(shape));
    return waiting.every((other) => {
      const given = other === member ? undefined : this.#expectationOf(other);
      const outputs = given === undefined ? [] : root.openIn(outputsOf(given));
      return !inputs.some((input) => outputs.includes(input));
    });
  }

  /**
   * What the scope knows is expected of `member`: of a union, the one member it can be a value of,
   * as a lambda passed for an optional function is one.
   */
  #expectationOf(member: PostponedMember): Type | undefined {
    const expectation = this.#root?.expectationOf(member.type, member.standsAlone !== true);
    if (expectation === undefined || expectation.kind !== 'union') {
      return expectation;
    }
    const isOpen = (part: Type) => this.#root?.mentionsVariables(part) === true;
    const taking = membersOf(expectation).filter((each) => member.admits(each, isOpen));
    return taking.length === 1 ? taking[0] : expectation;
  }

  /** How each variable of the scope settles, as the member it stands for settles it. */
  #settlingOf(): SettlingOf {
    return Inference.settlingsOf(this.#members);
  }
}

/** What a function of `shape` takes: its parameters' types and its pack, as one tuple. */
function inputsOf(shape: NonNullable<ReturnType<typeof expectedFunction>>): Type {
  return {
    kind: 'tuple',
    elements: [
      ...shape.parameters.map((parameter) => parameter.type),
      ...(shape.pack === undefined ? [] : [shape.pack]),
    ],
  };
}

/** What a value of `type` gives: its functions' results, as one tuple. */
function outputsOf(type: Type): Type {
  const shape = expectedFunction(type);
  return shape === undefined ? { kind: 'tuple', elements: [] } : shape.result;
}
