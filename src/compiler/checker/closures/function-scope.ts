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

/** One function being checked: the body's own (no node), or a nested one. */
export class FunctionScope {
  readonly node: NestedFunction | undefined;
  readonly isAsync: boolean;
  readonly returns: ReturnScope;
  readonly loops = new LoopScope();
  /** What the function captures, in the order first used. */
  readonly captures = new Map<Identifier, VariableEntity>();

  constructor(node: NestedFunction | undefined, isAsync: boolean, returns: ReturnScope) {
    this.node = node;
    this.isAsync = isAsync;
    this.returns = returns;
  }
}
