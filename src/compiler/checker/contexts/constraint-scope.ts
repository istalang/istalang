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
 * - Settling judges each member's postponed arguments, members joining while that runs included,
 *   then solves every variable together, writes each record that waited, solved, and completes each
 *   member in the order they joined, what it was given before it. One pass writes every record.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Inference } from '../types/inference/infer.ts';
import type { Settling } from '../types/inference/settle.ts';
import type { Type } from '../types/type/index.ts';

/**
 * Whether `node` is checked in the current scope (i2-scope.md §2): a call, a literal naming its
 * type, a non-empty array or map literal, maybe parenthesized. Any other kind is a boundary, whose
 * parts each settle on their own.
 */
export function joinsScope(node: Expression): boolean {
  switch (node.kind) {
    case 'Parenthesized':
      return joinsScope(node.expression);
    case 'Call':
    case 'NewStructLiteral':
      return true;
    case 'StructLiteral':
      return node.type !== undefined;
    case 'ArrayLiteral':
      return node.elements.length > 0;
    case 'MapLiteral':
      return node.entries.length > 0;
    default:
      return false;
  }
}

/**
 * Whether `node`, checked where no scope is open, opens one: a call, or a literal naming its type,
 * maybe parenthesized. A collection literal joins a scope another opened, but where none is open
 * is decided by where it goes, as ever.
 */
export function opensScope(node: Expression): boolean {
  switch (node.kind) {
    case 'Parenthesized':
      return opensScope(node.expression);
    case 'ArrayLiteral':
    case 'MapLiteral':
      return false;
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
  /** Judges its postponed arguments (resolution/calls/function-arguments.ts). */
  readonly judge: () => void;
  /** Completes it once the scope is solved, recording what it makes; its type then. */
  readonly complete: () => Type;
}

/** A body's constraint scopes, as its checking works through them (wiring/body/body-scopes.ts). */
export interface Scopes {
  /** Whether a scope is current. */
  readonly isOpen: boolean;
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
    // Members judging adds are judged too: an array's iterator reads its length at each step.
    for (const member of this.#members) {
      member.judge();
    }
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
}
