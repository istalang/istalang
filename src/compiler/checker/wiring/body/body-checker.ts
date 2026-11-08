/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`, or
 *   `fit` for a type already checked). Every type mismatch is reported through `fit`.
 * - What lowering needs is recorded as checking goes: every expression's type, every call's target,
 *   and every value's implicit conversions (§2, types/fitting/fit/index.ts), which `fit` finds: on
 *   the node giving the value, or, for a value an assignment writes, on its part
 *   (constructs/statements/assignments.ts). Nothing is recomputed later, so lowering sees what was
 *   checked.
 * - A node is checked once, but an item an argument literal checked ahead of it, which keeps what it
 *   was checked to have (constructs/expressions/literals/literal-items.ts). An expression checked
 *   in a constraint scope (contexts/constraint-scope.ts, body-scopes.ts) is recorded again once the
 *   scope settles: with its type solved, and a call or literal as completing it found. A value
 *   where a union is expected is checked as the member it is built as when that is decided before
 *   it is checked (§2, constructs/expressions/literals/built-members.ts); otherwise it goes in as
 *   fitting puts it, converted where its parts need (§3.5).
 * - The facts the body's rules gather (variables, the functions it nests, struct literals) are
 *   units of their own, beside those rules; this class only composes them. What they record of a
 *   node is kept per pass of a field loop (passes.ts), so the body reads as each pass checked it. A
 *   lambda or local function is checked in this same body, in a function scope of its own
 *   (constructs/closures/), so its result, loops and asyncness are the innermost scope's, and a
 *   name used in it is captured where it is used (`useEntity`).
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import { handlerOf } from '../../../../foundation/structures/kind-table.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Entity, VariantEntity } from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type {
  Call,
  Expression,
  FieldHeader,
  IndentedValue,
} from '../../../syntax/expressions/index.ts';
import type { BuiltLiteral } from '../../../syntax/expressions/literals/indented-values.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type {
  Assignment,
  Block,
  Statement,
  VariableDeclaration,
} from '../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../syntax/tree/index.ts';
import type { Identifier, Invalid } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { SignatureParameter } from '../../check.ts';
import { FunctionScope } from '../../constructs/closures/function-scope.ts';
import { FunctionScopes } from '../../constructs/closures/functions.ts';
import { inferLambda } from '../../constructs/closures/lambdas.ts';
import { declareOwnCall } from '../../constructs/closures/own-calls.ts';
import { ReturnScope } from '../../constructs/closures/returns.ts';
import { FieldReads } from '../../constructs/expressions/access/member-access.ts';
import { OptionalChains } from '../../constructs/expressions/access/optionals.ts';
import { CollectionForms } from '../../constructs/expressions/collections/collections.ts';
import {
  acceptedPartOf,
  acceptsOf,
  expressionHandlers,
} from '../../constructs/expressions/expressions.ts';
import { builtMember } from '../../constructs/expressions/literals/built-members.ts';
import { argumentPartOf } from '../../constructs/expressions/literals/literal-items.ts';
import { StructLiterals } from '../../constructs/expressions/structs/literal-sources.ts';
import { Iterations } from '../../constructs/loops/iteration.ts';
import { CheckedPatterns } from '../../constructs/patterns/matching.ts';
import { declareParameter, declareTargets } from '../../constructs/patterns/targets.ts';
import { LabelTargets } from '../../constructs/statements/loops.ts';
import { checkBlock, statementHandlers } from '../../constructs/statements/statements.ts';
import { VariableScope } from '../../constructs/statements/variables.ts';
import type {
  AcceptedPart,
  Accepts,
  BodyContext,
  CheckedPasses,
  Enclosing,
  LambdaGuide,
  Returns,
} from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { FieldPassType } from '../../contexts/passes.ts';
import { Passes } from '../../contexts/passes.ts';
import { ImplicitCalls } from '../../resolution/applying/implicit.ts';
import { blockTail } from '../../rules/agreement.ts';
import { checkDisposeUses } from '../../rules/disposal/disposal.ts';
import { checkDropped } from '../../rules/disposal/dropped.ts';
import { checkTestingCalls } from '../../rules/testing.ts';
import { statementPlace } from '../../surface/checked-annotation.ts';
import type { CheckedBody, FieldGiver, ValueSite } from '../../surface/checked-body.ts';
import type { ResolvedCall, ResolvedSite } from '../../surface/resolved-call.ts';
import { type Fit, isExact } from '../../types/fitting/fit/index.ts';
import { unfolded } from '../../types/type/computed-types.ts';
import type { FieldMember, FunctionType, Type } from '../../types/type/index.ts';
import { errorType, unitType } from '../../types/type/primitives.ts';
import { keysOwner } from '../../types/written/key-types.ts';
import { bodyRecords } from './body-records.ts';
import { BodyScopes, closed } from './body-scopes.ts';
import { checkedAt } from './facts/index.ts';
import { reportedFit } from './reported-fits.ts';

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
  /** The passes field loops are checked in; every record of a node below is kept per pass. */
  readonly #passes = new Passes();
  readonly variables = new VariableScope(this.#passes);
  readonly functions: FunctionScopes;
  readonly literals = new StructLiterals(this.#passes);
  readonly implicit = new ImplicitCalls(this.#passes);
  readonly collections = new CollectionForms(this.#passes);
  readonly iterations = new Iterations(this.#passes);
  readonly patterns = new CheckedPatterns(this.#passes);
  readonly chains = new OptionalChains(this.#passes);
  readonly fieldReads = new FieldReads(this.#passes);
  readonly labels = new LabelTargets();
  readonly #records = bodyRecords(this.#passes);
  /** The body's own result, which only the body's own function returns into. */
  readonly #result: ReturnScope;
  /** Items checked ahead of the argument literal holding them (`argumentPart`), kept as checked. */
  readonly #checkedAhead = new Set<Expression>();
  readonly scopes: BodyScopes;

  constructor(checker: CheckerContext, module: ModuleId, kind: BodyKind) {
    this.checker = checker;
    this.module = module;
    this.scopes = new BodyScopes((node, type) => {
      this.#record(node, type);
    });
    const isFunction = kind.kind === 'function';
    this.#result = new ReturnScope(kind.declaredResult, isFunction);
    const declaration = isFunction ? kind.declaration : undefined;
    const root = new FunctionScope(declaration, isFunction && kind.isAsync, this.#result);
    this.functions = new FunctionScopes(root, this.#passes);
  }

  get inAsync(): boolean {
    return this.functions.current.isAsync;
  }

  get returns(): Returns {
    return this.functions.current.returns;
  }

  get enclosing(): Enclosing {
    return this.functions.current.enclosing;
  }

  /** Checks a function's body against its parameters and its declared result, if any. */
  checkFunction(body: Block, parameters: readonly SignatureParameter[]): CheckedBody {
    for (const parameter of parameters) {
      declareParameter(this, parameter);
    }
    declareOwnCall(this);
    const tail = this.block(body, this.#result.declared);
    return this.#finished([body], this.#result.result(this, blockTail(body, tail)));
  }

  /**
   * What checking a function's default `values` found (signatures.ts), once they are all checked.
   */
  defaults(values: readonly Expression[]): CheckedBody {
    return this.#finished(values, unitType);
  }

  /** Checks a value of its own, such as a constant's initializer, against the declared result. */
  checkValue(node: Expression): CheckedBody {
    const { declared } = this.#result;
    const type = this.expect(node, declared);
    return this.#finished([node], declared ?? type);
  }

  /** Checks a top-level constant (§3): its initializer as `checkValue` does, then its targets. */
  checkConstant(declaration: VariableDeclaration): CheckedBody {
    const { declared } = this.#result;
    const type = this.expect(declaration.initializer, declared);
    const value = declared ?? type;
    declareTargets(this, declaration, value);
    return this.#finished([declaration.initializer], value);
  }

  /** The body checked from `roots`, after the rules over a whole body ran on it. */
  #finished(roots: readonly SyntaxNode[], result: Type): CheckedBody {
    this.variables.warnUnchanged(this);
    for (const root of roots) {
      checkDropped(this, root);
    }
    const calls = this.#records.resolved.entries();
    checkDisposeUses(this, calls, checkTestingCalls(this, calls));
    return checkedAt({ records: this.#records, units: this, result }, this.#passes.root);
  }

  expression(node: Expression, given?: Type): Type {
    const type = this.scopes.checking(node, given, (expected) => this.#checked(node, expected));
    return this.#records.types.get(node) ?? type;
  }

  settled(node: Expression, expected?: Type): Type {
    return this.scopes.suspended(() => this.expression(node, expected));
  }

  /** Checks `node` by its kind's handler, in whatever scope is current. */
  #checked(node: Expression, given: Type | undefined): Type {
    const expected = given === undefined ? undefined : unfolded(given);
    if (expected !== undefined) {
      this.#expected(node, expected);
      if (node.kind === 'StringLiteral') {
        this.recordKey(node, keysOwner(this.checker.fitting, expected));
      }
    }
    const checked = this.#checkedAhead.has(node) ? this.#records.types.get(node) : undefined;
    if (checked !== undefined) {
      return checked;
    }
    const guide =
      expected === undefined
        ? undefined
        : builtMember(this, node, expected, () => this.acceptedPart(node));
    return this.#record(node, handlerOf(expressionHandlers, node)(this, node, guide));
  }

  accepts(node: Expression): Accepts | undefined {
    return acceptsOf(this, node);
  }

  acceptedPart(node: Expression | undefined) {
    return acceptedPartOf(this, node);
  }

  argumentPart(node: Expression): AcceptedPart {
    return argumentPartOf(this, node, (item) => {
      this.expression(item);
      this.#checkedAhead.add(item);
    });
  }

  inferLambda(
    node: Expression,
    parameters: Pick<FunctionType, 'parameters' | 'pack'>,
    guide?: LambdaGuide,
  ): Type {
    if (node.kind === 'Parenthesized') {
      return this.#record(node, this.inferLambda(node.expression, parameters, guide));
    }
    if (node.kind !== 'Lambda') {
      unreachable(`A ${node.kind} has no result to infer.`);
    }
    return this.#record(node, inferLambda(this, node, parameters, guide));
  }

  #record(node: Expression, value: Type): Type {
    const type = this.chains.linked(this, node, unfolded(value));
    this.#records.types.set(node, type);
    this.scopes.recorded(type, (solved) => this.#records.types.set(node, solved));
    return type;
  }

  /** Records that `expected` is what `site` is expected to be, solved once its scope is. */
  #expected(site: ValueSite, expected: Type): void {
    this.#records.expected.set(site, expected);
    this.scopes.recorded(expected, (solved) => this.#records.expected.set(site, solved));
  }

  typeOf(node: Expression): Type {
    return this.checkedTypeOf(node) ?? errorType;
  }

  checkedTypeOf(node: Expression): Type | undefined {
    return this.#records.types.get(node);
  }

  callAt(site: ResolvedSite): ResolvedCall | undefined {
    return this.#records.resolved.get(site);
  }

  expectAt(site: Expression, expected: Type): void {
    this.#expected(site, expected);
  }

  expect(node: Expression, expected: Type | undefined): Type {
    const type = this.expression(node, expected);
    if (expected !== undefined) {
      this.fit(type, expected, node);
    }
    return type;
  }

  fit(found: Type, expected: Type, site: ValueSite, at = site.span): void {
    this.#expected(site, expected);
    const fit = reportedFit(this, found, expected, at);
    if (!isExact(fit)) {
      this.#records.fits.set(site, fit);
    }
  }

  fitWritten(found: Type, expected: Type, at: AnchoredSpan): Fit {
    return reportedFit(this, found, expected, at);
  }

  block(node: Block, expected?: Type): Type {
    return this.scopes.suspended(() =>
      checkBlock(this, node, { kind: 'value', expected: closed(expected) }),
    );
  }

  effectBlock(node: Block): void {
    this.scopes.suspended(() => checkBlock(this, node, { kind: 'effect' }));
  }

  statement(node: Statement | Invalid, expected?: Type): Type {
    if (node.kind !== 'Invalid') {
      this.checker.annotations.of(this.module, node, statementPlace(node));
    }
    return this.scopes.suspended(() =>
      handlerOf(statementHandlers, node)(this, node, closed(expected)),
    );
  }

  report(diagnostic: Diagnostic<AnchoredSpan>): void {
    if (!this.#passes.hold(diagnostic)) {
      this.checker.report(this.module, diagnostic);
    }
  }

  resolveType(node: TypeNode): Type {
    return this.checker.resolveType(this.module, node);
  }

  entityOf(name: Identifier): Entity | undefined {
    return this.checker.bindings.entityOf(this.module, name);
  }

  useEntity(name: Identifier): Entity | undefined {
    const entity = this.entityOf(name);
    if (entity?.kind === 'variable') {
      this.functions.noteUse(this, name, entity);
    }
    return entity;
  }

  recordCall(site: ResolvedSite, call: ResolvedCall): void {
    this.#records.resolved.set(site, call);
  }

  recordValueCall(node: Call): void {
    this.#records.valueCalls.set(node, true);
  }

  fieldPasses(
    header: FieldHeader,
    passes: readonly FieldPassType[],
    check: (pass: FieldPassType) => void,
  ): CheckedPasses {
    const { checked, inEach } = this.#passes.checkEach(passes, check, (diagnostic) =>
      this.report(diagnostic),
    );
    this.#records.fieldPasses.set(header, checked);
    return { inEach };
  }

  recordCandidates(site: ResolvedSite, candidates: readonly FunctionDeclaration[]): void {
    this.#records.candidates.set(site, candidates);
  }

  recordField(giver: FieldGiver, field: FieldMember): void {
    this.#records.givenFields.set(giver, field);
  }

  recordKey(value: Expression, owner: Type | undefined): void {
    const literal = unparenthesized(value);
    if (owner !== undefined && literal.kind === 'StringLiteral') {
      this.#records.keyOwners.set(literal, owner);
    }
  }

  recordBuilt(value: IndentedValue, literal: BuiltLiteral): void {
    this.#records.builtLiterals.set(value, literal);
  }

  recordVariant(name: Identifier, variant: VariantEntity): void {
    this.#records.chosenVariants.set(name, variant);
  }

  chosenVariantOf(name: Identifier): VariantEntity | undefined {
    return this.#records.chosenVariants.get(name);
  }

  ruleOut(body: Block): void {
    this.#records.ruledOut.set(body, true);
  }

  stopAt(operation: Expression | Assignment, operands: readonly Expression[]): void {
    this.#records.stops.set(operation, operands);
  }

  decide(condition: Expression, value: boolean): void {
    this.#records.decided.set(condition, value);
  }

  decidedAt(node: Expression): boolean | undefined {
    return this.#records.decided.get(node);
  }
}
