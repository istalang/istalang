/**
 * One function being checked within a body (§3.14): the body's own, or a lambda or local `fn`
 * nested in it, with what is the function's own while checking it: its result, its loops and
 * labelled blocks, whether it may `await`, the kind of code it is (proposal 8, Rule 2), and what
 * it captures (functions.ts).
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { FunctionFrame } from '../../contexts/body-context.ts';
import type { NestedFunction } from '../../surface/checked-body.ts';
import type { Type } from '../../types/type/index.ts';
import { EnclosingScopes } from './enclosing-scopes.ts';
import type { ReturnScope } from './returns.ts';

/** What is a function's own while checking it, beyond its node. */
interface FunctionOwn {
  readonly isAsync: boolean;
  readonly codeKind: Type;
  readonly returns: ReturnScope;
  /** What a nested function's text covers; none for the body's own function. */
  readonly reach?: AnchoredSpan | undefined;
}

/** What a body's own code is checked as: the function it is, if any, whether it may wait, its kind. */
export interface OwnScope {
  readonly function: FunctionDeclaration | undefined;
  readonly isAsync: boolean;
  readonly codeKind: Type;
}

/** The scope of a body's own code, as `own` says it is checked (wiring/body/body-kinds.ts). */
export function rootScope(own: OwnScope, returns: ReturnScope): FunctionScope {
  const { isAsync, codeKind } = own;
  return new FunctionScope(own.function, { isAsync, codeKind, returns });
}

/** One function being checked: the body's own, or a nested one. */
export class FunctionScope implements FunctionFrame {
  readonly function: NestedFunction | undefined;
  readonly reach: AnchoredSpan | undefined;
  readonly isAsync: boolean;
  readonly codeKind: Type;
  readonly returns: ReturnScope;
  readonly enclosing: EnclosingScopes;
  readonly #captures = new Map<Identifier, VariableEntity>();
  #cleanups = 0;
  #reliesOnKind = false;

  constructor(checked: NestedFunction | undefined, own: FunctionOwn) {
    this.function = checked;
    this.reach = own.reach;
    this.isAsync = own.isAsync;
    this.codeKind = own.codeKind;
    this.returns = own.returns;
    this.enclosing = new EnclosingScopes(checked?.name);
  }

  get captures(): ReadonlyMap<Identifier, VariableEntity> {
    return this.#captures;
  }

  capture(entity: VariableEntity): void {
    this.#captures.set(entity.name, entity);
  }

  get reliesOnKind(): boolean {
    return this.#reliesOnKind;
  }

  relyOnKind(): void {
    this.#reliesOnKind = true;
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
