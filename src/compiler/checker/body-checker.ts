/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`, or
 *   `fit` for a type already checked). Every type mismatch is reported through `fit`.
 * - What lowering needs is recorded as checking goes: every expression's type and every call's
 *   target. Nothing is recomputed later, so lowering sees exactly what was checked.
 * - The facts the body's rules gather (variables, the result, loops) are units of their own,
 *   beside those rules; this class only composes them.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import { handlerOf } from '../syntax/handlers.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { CallSite, CheckedBody, ResolvedCall, SignatureParameter } from './check.ts';
import type { BodyContext, CheckerContext } from './context.ts';
import { checkerDiagnostics } from './diagnostics.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { LoopScope } from './statements/loops.ts';
import { ReturnScope } from './statements/returns.ts';
import { checkBlock, statementHandlers } from './statements/statements.ts';
import { VariableScope } from './statements/variables.ts';
import { errorType, isAssignable, type Type } from './types/type.ts';
import { typeText } from './types/type-text.ts';

/** What a body is checked as: a function's, async or not, and what it must produce, if declared. */
export interface BodyKind {
  readonly isAsync: boolean;
  readonly declaredResult: Type | undefined;
}

export class BodyChecker implements BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly inAsync: boolean;
  readonly variables = new VariableScope();
  readonly returns: ReturnScope;
  readonly loops = new LoopScope();
  readonly #types = new Map<Expression, Type>();
  readonly #calls = new Map<CallSite, ResolvedCall>();

  constructor(checker: CheckerContext, module: ModuleId, kind: BodyKind) {
    this.checker = checker;
    this.module = module;
    this.inAsync = kind.isAsync;
    this.returns = new ReturnScope(kind.declaredResult);
  }

  /** Checks a function's body against its parameters and its declared result, if any. */
  checkFunction(body: Block, parameters: readonly SignatureParameter[]): CheckedBody {
    for (const parameter of parameters) {
      this.variables.declare(parameter.node.name, parameter.type);
    }
    const tail = this.block(body, this.returns.declared);
    const result = this.returns.result(this, body, tail);
    this.variables.warnUnreassigned(this);
    return this.#checked(result);
  }

  expression(node: Expression, expected?: Type): Type {
    const type = handlerOf(expressionHandlers, node)(this, node, expected);
    this.#types.set(node, type);
    return type;
  }

  expect(node: Expression, expected: Type): Type {
    const type = this.expression(node, expected);
    this.fit(type, expected, node.span);
    return type;
  }

  fit(found: Type, expected: Type, at: Span): void {
    if (!isAssignable(found, expected)) {
      this.report(checkerDiagnostics.typeMismatch(at, typeText(expected), typeText(found)));
    }
  }

  block(node: Block, expected?: Type): Type {
    return checkBlock(this, node, expected);
  }

  statement(node: Statement | Invalid, expected?: Type): Type {
    return handlerOf(statementHandlers, node)(this, node, expected);
  }

  report(diagnostic: Diagnostic): void {
    this.checker.report(this.module, diagnostic);
  }

  unsupported(node: NodeOf<string>, construct?: string): Type {
    return this.checker.unsupported(this.module, node, construct);
  }

  resolveType(node: TypeNode): Type {
    return this.checker.resolveType(this.module, node);
  }

  entityOf(name: Identifier): Entity | undefined {
    return this.checker.bindings.entityOf(this.module, name);
  }

  recordCall(site: CallSite, call: ResolvedCall): void {
    this.#calls.set(site, call);
  }

  /** The CheckedBody of what was checked, producing `result`. */
  #checked(result: Type): CheckedBody {
    const types = this.#types;
    const calls = this.#calls;
    return {
      typeOf: (expression) => types.get(expression) ?? errorType,
      callOf: (site) => calls.get(site),
      result,
    };
  }
}
