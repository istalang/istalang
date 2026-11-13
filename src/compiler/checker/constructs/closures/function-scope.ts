/**
 * One function being checked within a body (§3.14): the body's own, or a lambda or local `fn`
 * nested in it, with what is the function's own while checking it: its result, its loops and
 * labelled blocks, whether it may `await`, the kind of code it is (proposal 8, Rule 2), and what
 * it captures (functions.ts): the variables it uses from around it, and, for the function a
 * deferred call gives, what its call computed now (§3.14).
 */

import type { VariableEntity } from '../../../binder/entities.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { Expression, Spread } from '../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type {
  BodyContext,
  CapturedUse,
  FunctionFrame,
  MadeLater,
} from '../../contexts/body-context.ts';
import type { Capture, NestedFunction } from '../../surface/checked-body.ts';
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
  /** For the function a deferred call gives, what it makes later (§3.14). */
  readonly makesLater?: MadeLater | undefined;
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
  readonly makesLater: MadeLater | undefined;
  readonly #captures = new Map<Identifier, CapturedUse>();
  readonly #computed = new Map<Expression | Spread, Type>();
  #cleanups = 0;
  #reliesOnKind = false;

  constructor(checked: NestedFunction | undefined, own: FunctionOwn) {
    this.function = checked;
    this.reach = own.reach;
    this.isAsync = own.isAsync;
    this.codeKind = own.codeKind;
    this.returns = own.returns;
    this.makesLater = own.makesLater;
    this.enclosing = new EnclosingScopes(checked?.name);
  }

  get captures(): ReadonlyMap<Identifier, CapturedUse> {
    return this.#captures;
  }

  capture(entity: VariableEntity, site: Identifier): void {
    if (!this.#captures.has(entity.name)) {
      this.#captures.set(entity.name, { entity, site });
    }
  }

  get computed(): ReadonlyMap<Expression | Spread, Type> {
    return this.#computed;
  }

  captureComputed(site: Expression | Spread, type: Type): void {
    this.#computed.set(site, type);
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

/** What `scope` captured: its variables, in the order first used, then what was computed now. */
export function capturesOf(context: BodyContext, scope: FunctionScope): readonly Capture[] {
  const variables = [...scope.captures.values()].map(
    ({ entity, site }): Capture => ({
      kind: 'variable',
      entity,
      site,
      type: context.variables.typeOf(entity),
    }),
  );
  const computed = [...scope.computed].map(
    ([site, type]): Capture => ({ kind: 'computed', site, type }),
  );
  return [...variables, ...computed];
}
