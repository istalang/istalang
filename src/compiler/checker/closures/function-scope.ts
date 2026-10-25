/**
 * One function being checked within a body (§3.14): the body's own, or a lambda or local `fn`
 * nested in it, with what is the function's own while checking it: its result, its loops, whether
 * it may `await`, and what it captures (functions.ts).
 */

import type { VariableEntity } from '../../binder/entities.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { Lambda } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import { LoopScope } from '../statements/loops.ts';
import type { ReturnScope } from '../statements/returns.ts';

/** A function nested in a body: a lambda, or a local `fn` (a `const` bound to one, §3.14). */
export type NestedFunction = Lambda | FunctionDeclaration;

/** The local `fn` or named lambda whose own name `variable` is; undefined for any other variable. */
export function localFunctionOf(variable: VariableEntity): NestedFunction | undefined {
  const { owner } = variable;
  return (owner.kind === 'FunctionDeclaration' || owner.kind === 'Lambda') &&
    owner.name === variable.name
    ? owner
    : undefined;
}

/** One function being checked: the body's own, or a nested one. */
export class FunctionScope {
  /** The function checked: the body's own declaration, or a nested one; none for a value's body. */
  readonly function: NestedFunction | undefined;
  readonly isAsync: boolean;
  readonly returns: ReturnScope;
  readonly loops = new LoopScope();
  /** What the function captures, in the order first used. */
  readonly captures = new Map<Identifier, VariableEntity>();
  #cleanups = 0;

  constructor(checked: NestedFunction | undefined, isAsync: boolean, returns: ReturnScope) {
    this.function = checked;
    this.isAsync = isAsync;
    this.returns = returns;
  }

  /** Whether a `select` case watching this function's own call encloses what is checked (§7). */
  get inCleanup(): boolean {
    return this.#cleanups > 0;
  }

  /** Runs `check` inside a case that cleans up after this function's call is disposed. */
  cleanup<Result>(check: () => Result): Result {
    this.#cleanups += 1;
    try {
      return check();
    } finally {
      this.#cleanups -= 1;
    }
  }
}
