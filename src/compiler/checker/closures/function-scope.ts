/**
 * One function being checked within a body (§3.14): the body's own, or a lambda or local `fn`
 * nested in it, with what is the function's own while checking it: its result, its loops and
 * labelled blocks, whether it may `await`, and what it captures (functions.ts).
 */

import type { VariableEntity } from '../../binder/entities.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { NestedFunction } from '../check.ts';
import type { FunctionFrame } from '../context.ts';
import { EnclosingScopes } from './enclosing-scopes.ts';
import type { ReturnScope } from './returns.ts';

/** One function being checked: the body's own, or a nested one. */
export class FunctionScope implements FunctionFrame {
  readonly function: NestedFunction | undefined;
  readonly isAsync: boolean;
  readonly returns: ReturnScope;
  readonly enclosing: EnclosingScopes;
  readonly #captures = new Map<Identifier, VariableEntity>();
  #cleanups = 0;

  constructor(checked: NestedFunction | undefined, isAsync: boolean, returns: ReturnScope) {
    this.function = checked;
    this.isAsync = isAsync;
    this.returns = returns;
    this.enclosing = new EnclosingScopes(checked?.name);
  }

  get captures(): ReadonlyMap<Identifier, VariableEntity> {
    return this.#captures;
  }

  capture(entity: VariableEntity): void {
    this.#captures.set(entity.name, entity);
  }

  get inCleanup(): boolean {
    return this.#cleanups > 0;
  }

  cleanup<Result>(check: () => Result): Result {
    this.#cleanups += 1;
    try {
      return check();
    } finally {
      this.#cleanups -= 1;
    }
  }
}
