/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`, or
 *   `fit` for a type already checked). Every type mismatch is reported through `fit`.
 * - What lowering needs is recorded as checking goes: every expression's type, every call's
 *   target, and every value's implicit wraps into `T?` (§2), which `fit` finds: on the node giving
 *   the value, or, for a value an assignment writes, on its part (statements/assignments.ts).
 *   Nothing is recomputed later, so lowering sees exactly what was checked.
 * - The facts the body's rules gather (variables, the functions it nests, struct literals) are
 *   units of their own, beside those rules; this class only composes them. A lambda or local
 *   function is checked in this same body, in a function scope of its own (closures/), so its
 *   result, loops and asyncness are the innermost scope's, and a name used in it is captured
 *   where it is looked up (`entityOf`).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { handlerOf } from '../../structures/kind-table.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import type { TypeNode } from '../syntax/types.ts';
import type {
  CallSite,
  CheckedBody,
  ResolvedCall,
  SignatureParameter,
  ValueSite,
} from './check.ts';
import { FunctionScope } from './closures/function-scope.ts';
import { FunctionScopes } from './closures/functions.ts';
import { inferLambda } from './closures/lambdas.ts';
import type { LoopScope } from './closures/loop-scope.ts';
import { OwnCalls } from './closures/own-calls.ts';
import { blockTail, ReturnScope } from './closures/returns.ts';
import type { BodyContext, CheckerContext } from './context.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';
import { CollectionForms } from './expressions/collections.ts';
import { acceptsOf, expressionHandlers } from './expressions/expressions.ts';
import { StructLiterals } from './expressions/literal-fields.ts';
import { OptionalChains } from './expressions/optionals.ts';
import type { FrontierConstruct } from './frontier.ts';
import { CheckedPatterns } from './patterns/matching.ts';
import type { Accepts } from './resolution/choice.ts';
import { ImplicitCalls } from './resolution/implicit.ts';
import { statementPlace } from './rules/annotations.ts';
import { checkDisposeUses } from './rules/disposal.ts';
import { checkDropped } from './rules/dropped.ts';
import { Iterations } from './rules/iteration.ts';
import { checkTestingCalls } from './rules/testing-calls.ts';
import { checkBlock, statementHandlers } from './statements/statements.ts';
import { VariableScope } from './statements/variables.ts';
import { errorType, type FunctionType, type Type, unitType } from './types/type.ts';
import { typeText } from './types/type-text.ts';

/**
 * What a body is checked as, and what it must produce, if declared: a function's, async or not,
 * or a value of its own, such as a constant's or a parameter's default, which can't return.
 */
export type BodyKind =
  | {
      readonly kind: 'function';
      readonly declaration: FunctionDeclaration;
      readonly isAsync: boolean;
      readonly declaredResult: Type | undefined;
    }
  | { readonly kind: 'value'; readonly declaredResult: Type | undefined };

export class BodyChecker implements BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly variables = new VariableScope();
  readonly functions: FunctionScopes;
  readonly literals = new StructLiterals();
  readonly implicit = new ImplicitCalls();
  readonly collections = new CollectionForms();
  readonly iterations = new Iterations();
  readonly patterns = new CheckedPatterns();
  readonly chains = new OptionalChains();
  readonly ownCalls = new OwnCalls();
  readonly #types = new Map<Expression, Type>();
  readonly #calls = new Map<CallSite, ResolvedCall>();
  readonly #wraps = new Map<ValueSite, number>();

  constructor(checker: CheckerContext, module: ModuleId, kind: BodyKind) {
    this.checker = checker;
    this.module = module;
    const isFunction = kind.kind === 'function';
    const returns = new ReturnScope(kind.declaredResult, isFunction);
    const root = isFunction
      ? new FunctionScope(kind.declaration, kind.isAsync, returns)
      : new FunctionScope(undefined, false, returns);
    this.functions = new FunctionScopes(root);
  }

  get inAsync(): boolean {
    return this.functions.current.isAsync;
  }

  get returns(): ReturnScope {
    return this.functions.current.returns;
  }

  get loops(): LoopScope {
    return this.functions.current.loops;
  }

  /** Checks a function's body against its parameters and its declared result, if any. */
  checkFunction(body: Block, parameters: readonly SignatureParameter[]): CheckedBody {
    for (const parameter of parameters) {
      this.variables.declareParameter(parameter);
    }
    const tail = this.block(body, this.returns.declared);
    return this.#finished([body], this.returns.result(this, blockTail(body, tail)));
  }

  /** What checking a function's default `values` found (signatures.ts), once they are all checked. */
  defaults(values: readonly Expression[]): CheckedBody {
    return this.#finished(values, unitType);
  }

  /** Checks a value of its own, such as a constant's initializer, against the declared result. */
  checkValue(node: Expression): CheckedBody {
    const { declared } = this.returns;
    const type = this.expect(node, declared);
    return this.#finished([node], declared ?? type);
  }

  /** The body checked from `roots`, after the rules over a whole body ran on it. */
  #finished(roots: readonly SyntaxNode[], result: Type): CheckedBody {
    this.variables.warnUnchanged(this);
    for (const root of roots) {
      checkDropped(this, root);
    }
    checkDisposeUses(this, this.#calls, checkTestingCalls(this, this.#calls));
    return this.#checked(result);
  }

  expression(node: Expression, expected?: Type): Type {
    return this.#record(node, handlerOf(expressionHandlers, node)(this, node, expected));
  }

  accepts(node: Expression): Accepts | undefined {
    return acceptsOf(this, node);
  }

  inferLambda(node: Expression, parameters: FunctionType['parameters']): Type {
    if (node.kind === 'Parenthesized') {
      return this.#record(node, this.inferLambda(node.expression, parameters));
    }
    if (node.kind !== 'Lambda') {
      unreachable(`A ${node.kind} has no result to infer.`);
    }
    return this.#record(node, inferLambda(this, node, parameters));
  }

  #record(node: Expression, value: Type): Type {
    const type = this.chains.linked(this, node, value);
    this.#types.set(node, type);
    return type;
  }

  typeOf(node: Expression): Type {
    return this.#types.get(node) ?? errorType;
  }

  callAt(site: CallSite): ResolvedCall | undefined {
    return this.#calls.get(site);
  }

  expect(node: Expression, expected: Type | undefined): Type {
    const type = this.expression(node, expected);
    if (expected !== undefined) {
      this.fit(type, expected, node);
    }
    return type;
  }

  fit(found: Type, expected: Type, site: ValueSite, at = site.span): void {
    const wraps = this.#wrapsToFit(found, expected, at);
    if (wraps > 0) {
      this.#wraps.set(site, wraps);
    }
  }

  fitWritten(found: Type, expected: Type, at: Span): number {
    return this.#wrapsToFit(found, expected, at);
  }

  /** How many times a `found` is wrapped to fit `expected`; none after reporting a mismatch at `at`. */
  #wrapsToFit(found: Type, expected: Type, at: Span): number {
    const wraps = this.checker.wrapsToFit(found, expected);
    if (wraps === undefined) {
      this.#mismatch(found, expected, at);
    }
    return wraps ?? 0;
  }

  fitUnwrapped(found: Type, expected: Type, at: Span): void {
    if (this.checker.wrapsToFit(found, expected) !== 0) {
      this.#mismatch(found, expected, at);
    }
  }

  #mismatch(found: Type, expected: Type, at: Span): void {
    this.report(checkerDiagnostics.typeMismatch(at, typeText(expected), typeText(found)));
  }

  block(node: Block, expected?: Type): Type {
    return checkBlock(this, node, { kind: 'value', expected });
  }

  effectBlock(node: Block): void {
    checkBlock(this, node, { kind: 'effect' });
  }

  statement(node: Statement | Invalid, expected?: Type): Type {
    if (node.kind !== 'Invalid') {
      this.checker.annotations.of(this.module, node, statementPlace(node));
    }
    return handlerOf(statementHandlers, node)(this, node, expected);
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

  /** What `name` denotes; a variable used inside a closure is captured there (§3.14). */
  entityOf(name: Identifier): Entity | undefined {
    const entity = this.checker.bindings.entityOf(this.module, name);
    if (entity?.kind === 'variable') {
      this.functions.noteUse(this, name, entity);
    }
    return entity;
  }

  recordCall(site: CallSite, call: ResolvedCall): void {
    this.#calls.set(site, call);
  }

  /** The CheckedBody of what was checked, producing `result`. */
  #checked(result: Type): CheckedBody {
    const types = this.#types;
    const calls = this.#calls;
    const wraps = this.#wraps;
    const {
      variables,
      literals,
      implicit,
      collections,
      iterations,
      patterns,
      chains,
      functions,
      ownCalls,
    } = this;
    return {
      typeOf: (expression) => types.get(expression) ?? errorType,
      calls,
      madeCalls: () => [
        ...[...calls].map(([site, call]) => ({ site, call })),
        ...implicit.made(),
        ...literals.made(),
      ],
      implicitCallOf: (node, role) => implicit.of(node, role),
      collectionFormOf: (literal) => collections.of(literal),
      iterationOf: (iteration) => iterations.of(iteration),
      wrapsOf: (site) => wraps.get(site) ?? 0,
      targetsOf: (owner) => variables.targetsOf(owner),
      assignedOf: (assignment) => variables.assignedOf(assignment),
      inCell: (name) => variables.inCell(name),
      functionOf: (node) => functions.checkedOf(node),
      sourcesOf: (literal) => literals.sourcesOf(literal),
      patternOf: (pattern) => patterns.patternOf(pattern),
      chainOf: (link) => chains.chainOf(link),
      ownCallReadAt: (name) => ownCalls.readAt(name),
      ownCallOf: (owner) => ownCalls.variableOf(owner),
      result,
    };
  }
}
