/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`, or
 *   `fit` for a type already checked). Every type mismatch is reported through `fit`.
 * - What lowering needs is recorded as checking goes: every expression's type, every call's
 *   target, and every value's implicit wraps into `T?` (§2), which `fit` finds. Nothing is
 *   recomputed later, so lowering sees exactly what was checked.
 * - The facts the body's rules gather (variables, the result, loops) are units of their own,
 *   beside those rules; this class only composes them.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { handlerOf } from '../../structures/kind-table.ts';
import { withPushed } from '../../structures/stack.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { CallSite, CheckedBody, ResolvedCall, SignatureParameter } from './check.ts';
import type { BodyContext, CheckerContext } from './context.ts';
import { checkerDiagnostics } from './diagnostics.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { StructLiterals } from './expressions/literal-fields.ts';
import type { FrontierConstruct } from './frontier.ts';
import { passesValueOn, refuseHeldFuture } from './rules/futures.ts';
import { LoopScope } from './statements/loops.ts';
import { ReturnScope } from './statements/returns.ts';
import { checkBlock, statementHandlers } from './statements/statements.ts';
import { VariableScope } from './statements/variables.ts';
import { errorType, type Type, unitType } from './types/type.ts';
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
  readonly literals = new StructLiterals();
  readonly #types = new Map<Expression, Type>();
  readonly #calls = new Map<CallSite, ResolvedCall>();
  readonly #wraps = new Map<Expression, number>();
  /** The expressions and statements being checked, innermost last: what receives each value. */
  readonly #within: NodeOf<string>[] = [];

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
    this.variables.warnUnchanged(this);
    return this.#checked(result);
  }

  /** What checking a function's default values found (signatures.ts), once they are all checked. */
  defaults(): CheckedBody {
    return this.#checked(unitType);
  }

  /** Checks a value of its own, such as a constant's initializer, against the declared result. */
  checkValue(node: Expression): CheckedBody {
    const { declared } = this.returns;
    const type = this.expect(node, declared);
    return this.#checked(declared ?? type);
  }

  expression(node: Expression, expected?: Type): Type {
    const receiver = this.#within.at(-1);
    const type = withPushed(this.#within, node, () =>
      handlerOf(expressionHandlers, node)(this, node, expected),
    );
    this.#types.set(node, type);
    if (receiver !== undefined && !passesValueOn(receiver)) {
      refuseHeldFuture(this.checker, this.module, node, type);
    }
    return type;
  }

  expect(node: Expression, expected: Type | undefined): Type {
    const type = this.expression(node, expected);
    if (expected !== undefined) {
      this.fit(type, expected, node);
    }
    return type;
  }

  fit(found: Type, expected: Type, at: Expression | Span): void {
    const wraps = this.checker.wrapsToFit(found, expected);
    const isNode = 'kind' in at;
    if (wraps === undefined || (wraps > 0 && !isNode)) {
      const span = isNode ? at.span : at;
      this.report(checkerDiagnostics.typeMismatch(span, typeText(expected), typeText(found)));
    } else if (wraps > 0 && isNode) {
      this.#wraps.set(at, wraps);
    }
  }

  block(node: Block, expected?: Type): Type {
    return checkBlock(this, node, { kind: 'value', expected });
  }

  effectBlock(node: Block): void {
    checkBlock(this, node, { kind: 'effect' });
  }

  statement(node: Statement | Invalid, expected?: Type): Type {
    return withPushed(this.#within, node, () =>
      handlerOf(statementHandlers, node)(this, node, expected),
    );
  }

  report(diagnostic: Diagnostic): void {
    this.checker.report(this.module, diagnostic);
  }

  unsupported(node: NodeOf<string>, construct?: FrontierConstruct): Type {
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
    const wraps = this.#wraps;
    const { variables, literals } = this;
    return {
      typeOf: (expression) => types.get(expression) ?? errorType,
      calls,
      wrapsOf: (expression) => wraps.get(expression) ?? 0,
      targetsOf: (declaration) => variables.targetsOf(declaration),
      assignedOf: (assignment) => variables.assignedOf(assignment),
      isReferenced: (name) => variables.isReferenced(name),
      sourcesOf: (literal) => literals.sourcesOf(literal),
      result,
    };
  }
}
