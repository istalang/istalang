/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`).
 * - What lowering needs is recorded as checking goes: every expression's type and every call's
 *   target. Nothing is recomputed later, so lowering sees exactly what was checked.
 * - A body with no declared result produces the one its tail and its `return`s agree on; `never`
 *   (a `return`, `break` or `continue`) agrees with anything (§4).
 * - A `let` that nothing reassigns gets a warning once the whole body has been seen (§3.4).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Span } from '../../text/span.ts';
import type { Entity, VariableEntity, VariableOwner } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { Expression } from '../syntax/expressions.ts';
import { handlerOf } from '../syntax/handlers.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
import type { Block } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { CallSite, CheckedBody, ResolvedCall, SignatureParameter } from './check.ts';
import type { BodyContext, CheckerContext } from './context.ts';
import { checkerDiagnostics } from './diagnostics.ts';
import { expressionHandlers } from './expressions/expressions.ts';
import { agreedType, type Produced } from './rules/agreement.ts';
import { checkBlock, tailOf } from './statements/statements.ts';
import { errorType, isAssignable, type Type, unitType } from './types/type.ts';
import { typeText } from './types/type-text.ts';

export class BodyChecker implements BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly #body: Block;
  readonly #types = new Map<Expression, Type>();
  readonly #calls = new Map<CallSite, ResolvedCall>();
  readonly #variables = new Map<Identifier, Type>();
  readonly #reassigned = new Set<VariableOwner>();
  readonly #returned: Produced[] = [];
  #declaredResult: Type | undefined;
  #loops = 0;

  constructor(checker: CheckerContext, module: ModuleId, body: Block) {
    this.checker = checker;
    this.module = module;
    this.#body = body;
  }

  /** Checks the body against its parameters and its declared result, if any. */
  check(parameters: readonly SignatureParameter[], declaredResult: Type | undefined): CheckedBody {
    this.#declaredResult = declaredResult;
    for (const parameter of parameters) {
      this.declareVariable(parameter.node.name, parameter.type);
    }
    const tail = this.block(this.#body, declaredResult);
    const result = declaredResult ?? this.#inferredResult(tail);
    if (declaredResult !== undefined && !isAssignable(tail, declaredResult)) {
      this.#reportMismatch(tailOf(this.#body), declaredResult, tail);
    }
    this.#warnUnreassigned();
    const types = this.#types;
    const calls = this.#calls;
    return {
      typeOf: (expression) => types.get(expression) ?? errorType,
      callOf: (site) => calls.get(site),
      result,
    };
  }

  expression(node: Expression, expected?: Type): Type {
    const type = handlerOf(expressionHandlers, node)(this, node, expected);
    this.#types.set(node, type);
    return type;
  }

  expect(node: Expression, expected: Type): Type {
    const type = this.expression(node, expected);
    if (!isAssignable(type, expected)) {
      this.#reportMismatch(node, expected, type);
    }
    return type;
  }

  block(node: Block, expected?: Type): Type {
    return checkBlock(this, node, expected);
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

  variableType(variable: VariableEntity): Type {
    return this.#variables.get(variable.name) ?? errorType;
  }

  declareVariable(name: Identifier, type: Type): void {
    this.#variables.set(name, type);
  }

  noteReassigned(owner: VariableOwner): void {
    this.#reassigned.add(owner);
  }

  recordCall(site: CallSite, call: ResolvedCall): void {
    this.#calls.set(site, call);
  }

  checkReturn(value: Expression | undefined, span: Span): void {
    const expected = this.#declaredResult;
    if (value === undefined) {
      if (expected !== undefined && !isAssignable(unitType, expected)) {
        this.report(checkerDiagnostics.typeMismatch(span, typeText(expected), typeText(unitType)));
      }
      this.#returned.push({ type: unitType, span });
      return;
    }
    const type = expected === undefined ? this.expression(value) : this.expect(value, expected);
    this.#returned.push({ type, span: value.span });
  }

  insideLoop<Result>(check: () => Result): Result {
    this.#loops += 1;
    try {
      return check();
    } finally {
      this.#loops -= 1;
    }
  }

  get inLoop(): boolean {
    return this.#loops > 0;
  }

  /** The type the tail and every `return` agree on (§4). */
  #inferredResult(tail: Type): Type {
    const produced = [...this.#returned, { type: tail, span: tailOf(this.#body).span }];
    const { decided, disagreeing } = agreedType(produced);
    for (const { type, span } of disagreeing) {
      this.report(checkerDiagnostics.typeMismatch(span, typeText(decided ?? type), typeText(type)));
    }
    return decided ?? tail;
  }

  #reportMismatch(at: NodeOf<string>, expected: Type, found: Type): void {
    this.report(checkerDiagnostics.typeMismatch(at.span, typeText(expected), typeText(found)));
  }

  /** §3.4: a `let` never reassigned should be a `const`. */
  #warnUnreassigned(): void {
    for (const name of this.#variables.keys()) {
      const entity = this.entityOf(name);
      const owner = entity?.kind === 'variable' ? entity.owner : undefined;
      if (
        owner?.kind === 'VariableDeclaration' &&
        owner.isMutable &&
        !this.#reassigned.has(owner) &&
        name.text !== '_'
      ) {
        this.report(checkerDiagnostics.letNeverReassigned(name.span, name.text));
      }
    }
  }
}
