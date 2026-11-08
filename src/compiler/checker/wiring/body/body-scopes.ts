/**
 * A body's constraint scopes (docs/work/variance-inference/i2-scope.md, contexts/constraint-scope.ts):
 * which one is current, and in which one each expression is checked. BodyChecker checks and
 * records; this decides the scope that happens in.
 *
 * - A node of a kind that joins a scope is checked in the current one; where none is open, a call
 *   opens one, which settles once the call is checked, on every path, a throw included, and a
 *   literal is checked as ever. Any other kind is a boundary: it suspends the current scope while it
 *   is checked, so its parts each settle on their own.
 * - What an expression checked outside a scope expects never names a variable, which only the scope
 *   holding it knows (`closed`).
 * - A member that joins with no scope open settles at once, in a scope of its own, which its
 *   inference's system is, so what it judges still joins it.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import {
  ConstraintScope,
  joinsScope,
  opensScope,
  type PostponedMember,
  type ScopeMember,
  type ScopeSettling,
  type Scopes,
} from '../../contexts/constraint-scope.ts';
import type { Inference } from '../../types/inference/infer.ts';
import { mentionsAnyVariable } from '../../types/inference/variables.ts';
import type { Type } from '../../types/type/index.ts';

export class BodyScopes implements Scopes {
  readonly #settling: ScopeSettling;
  #current: ConstraintScope | undefined;

  /** `record` records a node's type, as settling a scope records each member's. */
  constructor(record: (node: Expression, type: Type) => void) {
    this.#settling = { suspended: (check) => this.suspended(check), record };
  }

  get isOpen(): boolean {
    return this.#current !== undefined;
  }

  get current(): ConstraintScope | undefined {
    return this.#current;
  }

  within<Result>(scope: ConstraintScope | undefined, check: () => Result): Result {
    const outer = this.#current;
    this.#current = scope;
    try {
      return check();
    } finally {
      this.#current = outer;
    }
  }

  holds(type: Type | undefined): boolean {
    return type !== undefined && this.#current?.holds(type) === true;
  }

  /** The inference holding the current scope's system; undefined while none is open. */
  get root(): Inference | undefined {
    return this.#current?.root;
  }

  /**
   * Checks `node` by `check` in the scope its kind takes, with what it may read of `given`; one the
   * scope may postpone (`postponable`) joins it too.
   */
  checking(
    node: Expression,
    given: Type | undefined,
    check: (expected: Type | undefined) => Type,
    postponable = false,
  ): Type {
    if (!(postponable || joinsScope(node))) {
      return this.suspended(() => check(closed(given)));
    }
    if (this.#current !== undefined) {
      return check(given);
    }
    if (!opensScope(node)) {
      return check(closed(given));
    }
    return this.#opening(new ConstraintScope(), () => check(closed(given)));
  }

  /** Runs `check` with no scope current, `expected` read as outside one: what it gives. */
  suspended<Result>(check: () => Result): Result {
    return this.within(undefined, check);
  }

  /** Runs `check` in a scope of its own, which settles once it is done: its type, settled. */
  isolated(check: () => Type): Type {
    const scope = new ConstraintScope();
    const type = this.#opening(scope, check);
    return scope.solved(type);
  }

  commit(inference: Inference): void {
    this.#current?.commit(inference);
  }

  /** Joins `member` to the current scope: its type, open; with none open, settles it: its type. */
  join(member: ScopeMember): Type {
    if (this.#current !== undefined) {
      this.#current.join(member);
      return member.type;
    }
    let completed = member.type;
    const complete = () => {
      completed = member.complete();
      return completed;
    };
    this.#opening(new ConstraintScope(), () => this.#current?.join({ ...member, complete }));
    return completed;
  }

  postpone(member: PostponedMember): Type {
    const scope = this.#current ?? unreachable('A placeholder joins only an open scope.');
    scope.postpone(member);
    return member.type;
  }

  guided(type: Type): Type {
    return this.#current?.guided(type) ?? type;
  }

  /** Gives the error type where each of `types` still open in the current scope goes. */
  abandon(types: readonly (Type | undefined)[]): void {
    const scope = this.#current;
    for (const type of types) {
      if (type !== undefined && scope?.holds(type) === true) {
        scope.root?.abandon(type);
      }
    }
  }

  whenSolved(work: (solved: (type: Type) => Type) => void): void {
    if (this.#current === undefined) {
      work((type) => type);
    } else {
      this.#current.whenSolved(work);
    }
  }

  /**
   * Notes a record written as `type`, which `write` writes again with it solved once the current
   * scope settles, when the scope holds it.
   */
  recorded(type: Type, write: (solved: Type) => void): void {
    if (this.#current?.holds(type) === true) {
      this.whenSolved((solved) => write(solved(type)));
    }
  }

  /** Runs `check` in `scope`, settling it once done, on every path; the outer one current again. */
  #opening<Result>(scope: ConstraintScope, check: () => Result): Result {
    const outer = this.#current;
    this.#current = scope;
    try {
      return check();
    } finally {
      try {
        scope.settle(this.#settling);
      } finally {
        this.#current = outer;
      }
    }
  }
}

/**
 * `expected` as an expression checked outside a scope reads it: none where it mentions a call's
 * variable, which only the scope holding it knows.
 */
export function closed(expected: Type | undefined): Type | undefined {
  return expected !== undefined && mentionsAnyVariable(expected) ? undefined : expected;
}
