/**
 * A body's constraint scopes (docs/work/variance-inference/i2-scope.md, constraint-scope.ts): which
 * one is current, and in which one each expression is checked, as the scope protocol places it
 * (scope-protocol.ts). BodyChecker checks and records; this decides the scope that happens in.
 *
 * - An expression that opens a scope where none is current settles it once it is checked, on every
 *   path, a throw included. One checked with no scope current (a boundary, a literal decided by
 *   where it goes, a part read settled) has its parts each settle on their own.
 * - What an expression checked outside a scope expects never names a variable, which only the scope
 *   holding it knows (`closed`), but for a literal decided by where it goes, which reads it as
 *   given.
 * - A member that joins with no scope open settles at once, in a scope of its own, which its
 *   inference's system is, so what it judges still joins it.
 */

import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Expression } from '../../../syntax/expressions/index.ts';
import type { InScope, PostponedMember, ScopeMember, Scopes } from '../../contexts/scopes.ts';
import type { Inference } from '../../types/inference/infer.ts';
import { mentionsAnyVariable } from '../../types/inference/variables.ts';
import type { Type } from '../../types/type/index.ts';
import { ConstraintScope, type ScopeSettling } from './constraint-scope.ts';
import { placeOf, standingOf } from './scope-protocol.ts';

export class BodyScopes implements Scopes {
  readonly #settling: ScopeSettling;
  #current: ConstraintScope | undefined;

  readonly decidesItems: (expected: Type) => boolean;

  /**
   * `record` records a node's type, as settling a scope records each member's; `decidesItems` is
   * the protocol's (scope-protocol.ts `ScopeHolding`).
   */
  constructor(
    record: (node: Expression, type: Type) => void,
    decidesItems: (expected: Type) => boolean,
  ) {
    this.#settling = { suspended: (check) => this.suspended(check), record };
    this.decidesItems = decidesItems;
  }

  get isOpen(): boolean {
    return this.#current !== undefined;
  }

  here(): InScope {
    const scope = this.#current;
    return (check) => this.#within(scope, check);
  }

  holds(type: Type | undefined): boolean {
    return type !== undefined && this.#current?.holds(type) === true;
  }

  /** The inference holding the current scope's system; undefined while none is open. */
  get root(): Inference | undefined {
    return this.#current?.root;
  }

  /**
   * Checks `node` by `check` where the protocol places it, with what it may read of `given`; one
   * the scope may postpone (`postponable`) in the current scope, if any.
   */
  checking(
    node: Expression,
    given: Type | undefined,
    check: (expected: Type | undefined) => Type,
    postponable: boolean,
  ): Type {
    // `default` is 'opens'.
    switch (placeOf(this, node, given, postponable)) {
      case 'boundary':
        return this.suspended(() => check(closed(given)));
      case 'decided':
        return this.suspended(() => check(given));
      case 'joins':
        return this.#current === undefined ? check(closed(given)) : check(given);
      default:
        return this.#current === undefined
          ? this.#opening(new ConstraintScope(), () => check(closed(given)))
          : check(given);
    }
  }

  /**
   * Runs `handle`, `node`'s handler where `expected` is what it is checked against: with no scope
   * current for a literal decided by where it goes, so its items settle on their own; else as it
   * stands. A postponed member is judged through here too, placed where it joined.
   */
  handling(node: Expression, expected: Type | undefined, handle: () => Type): Type {
    return standingOf(this, node, expected) === 'decided' ? this.suspended(handle) : handle();
  }

  /** Runs `check` with no scope current: what it gives. */
  suspended<Result>(check: () => Result): Result {
    return this.#within(undefined, check);
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

  fixDefaults(types: readonly (Type | undefined)[]): boolean {
    const open = types.filter((type): type is Type => this.holds(type));
    return this.#current?.fixDefaults(open) === true;
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

  /** Runs `check` with `scope` current, the outer one current again after. */
  #within<Result>(scope: ConstraintScope | undefined, check: () => Result): Result {
    const outer = this.#current;
    this.#current = scope;
    try {
      return check();
    } finally {
      this.#current = outer;
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
