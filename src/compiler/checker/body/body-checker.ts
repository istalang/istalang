/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`, or
 *   `fit` for a type already checked). Every type mismatch is reported through `fit`.
 * - What lowering needs is recorded as checking goes: every expression's type, every call's
 *   target, and every value's implicit conversions (§2, types/fitting/fit.ts), which `fit` finds: on the
 *   node giving the value, or, for a value an assignment writes, on its part
 *   (statements/assignments.ts). Nothing is recomputed later, so lowering sees what was checked.
 * - A node is checked once. A literal of items each with a type of its own, checked before the type
 *   it is built as is decided (§3.7: a call's argument, a producer agreeing with others), is built
 *   again as that type (`rebuild`): its own literals are checked again as their parts, and every
 *   other item keeps what it was checked to have, fitted to its part, as an item an argument literal
 *   checked ahead of it does (expressions/literal-items.ts). So is a tuple or struct
 *   literal whose items' types only checking tells, and a collection literal an `any` member might
 *   take whole, where its own type doesn't go into the union expected: as the one member its checked
 *   items build it as (§2, expressions/built-members.ts). Any other collection literal is built
 *   as its member before its items are checked, so they agree on that member's item.
 * - The facts the body's rules gather (variables, the functions it nests, struct literals) are
 *   units of their own, beside those rules; this class only composes them. What they record of a
 *   node is kept per pass of a field loop (passes.ts), so the body reads as each pass checked it.
 *   A lambda or local function is checked in this same body, in a function scope of its own
 *   (closures/), so its result, loops and asyncness are the innermost scope's, and a name used in
 *   it is captured where it is used (`useEntity`).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { handlerOf } from '../../../structures/kind-table.ts';
import { withPushed } from '../../../structures/stack.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Entity, VariantEntity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { BuiltLiteral } from '../../syntax/expressions/indented-values.ts';
import type {
  Call,
  Expression,
  FieldHeader,
  IndentedValue,
} from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import type { Identifier, Invalid } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Assignment, Block, Statement, VariableDeclaration } from '../../syntax/statements.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type {
  AcceptedPart,
  Accepts,
  BodyContext,
  CheckedPasses,
  Enclosing,
  Returns,
} from '../body-context.ts';
import type { SignatureParameter } from '../check.ts';
import { FunctionScope } from '../closures/function-scope.ts';
import { FunctionScopes } from '../closures/functions.ts';
import { inferLambda } from '../closures/lambdas.ts';
import { declareOwnCall } from '../closures/own-calls.ts';
import { blockTail, ReturnScope } from '../closures/returns.ts';
import type { CheckerContext } from '../context.ts';
import { builtAsChecked, builtMember } from '../expressions/built-members.ts';
import { CollectionForms } from '../expressions/collections.ts';
import {
  acceptedPartOf,
  acceptsOf,
  checkedPartOf,
  expressionHandlers,
  isBuiltLiteral,
} from '../expressions/expressions.ts';
import { argumentPartOf } from '../expressions/literal-items.ts';
import { StructLiterals } from '../expressions/literal-sources.ts';
import { FieldReads } from '../expressions/member-access.ts';
import { OptionalChains } from '../expressions/optionals.ts';
import type { FieldPassType } from '../passes.ts';
import { Passes } from '../passes.ts';
import { CheckedPatterns } from '../patterns/matching.ts';
import { declareParameter, declareTargets } from '../patterns/targets.ts';
import { ImplicitCalls } from '../resolution/implicit.ts';
import { reportUnmet } from '../resolution/trait-objects.ts';
import { checkDisposeUses } from '../rules/disposal/disposal.ts';
import { checkDropped } from '../rules/disposal/dropped.ts';
import { Iterations } from '../rules/loops/iteration.ts';
import { checkTestingCalls } from '../rules/testing.ts';
import { LabelTargets } from '../statements/loops.ts';
import { checkBlock, statementHandlers } from '../statements/statements.ts';
import { VariableScope } from '../statements/variables.ts';
import { statementPlace } from '../surface/checked-annotation.ts';
import type { CheckedBody, ValueSite } from '../surface/checked-body.ts';
import type { ResolvedCall, ResolvedSite } from '../surface/resolved-call.ts';
import { unfolded } from '../types/computed-types.ts';
import { exactFit, type Fit, isExact, misfitOf } from '../types/fitting/fit.ts';
import type { FieldMember, FunctionType, Type } from '../types/type/index.ts';
import { errorType, unitType } from '../types/type/primitives.ts';
import { keysOwner } from '../types/written/key-types.ts';
import { useSite } from '../use-site.ts';
import { bodyRecords } from './body-records.ts';
import { checkedAt } from './facts/index.ts';

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
  /** The literals being built again as another type (`rebuild`), their items kept. */
  readonly #rebuilt: Expression[] = [];
  /** Items checked ahead of the argument literal holding them (`argumentPart`), kept as checked. */
  readonly #checkedAhead = new Set<Expression>();

  constructor(checker: CheckerContext, module: ModuleId, kind: BodyKind) {
    this.checker = checker;
    this.module = module;
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

  /** What checking a function's default `values` found (signatures.ts), once they are all checked. */
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
    const expected = given === undefined ? undefined : unfolded(given);
    if (expected !== undefined) {
      this.#records.expected.set(node, expected);
      if (node.kind === 'StringLiteral') {
        this.recordKey(node, keysOwner(this.checker.fitting, expected));
      }
    }
    const kept = this.#rebuilt.length > 0 || this.#checkedAhead.has(node);
    const checked = kept && !isBuiltLiteral(node) ? this.#records.types.get(node) : undefined;
    if (checked !== undefined) {
      return checked;
    }
    const guide =
      expected === undefined
        ? undefined
        : builtMember(this, node, expected, () => this.acceptedPart(node));
    const type = this.#record(node, handlerOf(expressionHandlers, node)(this, node, guide));
    return guide?.kind === 'union' ? builtAsChecked(this, node, type, guide) : type;
  }

  accepts(node: Expression): Accepts | undefined {
    return acceptsOf(this, node);
  }

  acceptedPart(node: Expression | undefined) {
    return acceptedPartOf(this, node);
  }

  checkedPart(node: Expression | undefined) {
    return checkedPartOf(this, node);
  }

  argumentPart(node: Expression): AcceptedPart {
    return argumentPartOf(this, node, (item) => {
      this.expression(item);
      this.#checkedAhead.add(item);
    });
  }

  inferLambda(node: Expression, parameters: Pick<FunctionType, 'parameters' | 'pack'>): Type {
    if (node.kind === 'Parenthesized') {
      return this.#record(node, this.inferLambda(node.expression, parameters));
    }
    if (node.kind !== 'Lambda') {
      unreachable(`A ${node.kind} has no result to infer.`);
    }
    return this.#record(node, inferLambda(this, node, parameters));
  }

  #record(node: Expression, value: Type): Type {
    const type = this.chains.linked(this, node, unfolded(value));
    this.#records.types.set(node, type);
    return type;
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

  expect(node: Expression, expected: Type | undefined): Type {
    const type = this.expression(node, expected);
    if (expected !== undefined) {
      this.fit(type, expected, node);
    }
    return type;
  }

  rebuild(node: Expression, type: Type): Type {
    return withPushed(this.#rebuilt, node, () => this.expect(node, type));
  }

  fit(found: Type, expected: Type, site: ValueSite, at = site.span): void {
    this.#records.expected.set(site, expected);
    const fit = this.#fitOf(found, expected, at);
    if (!isExact(fit)) {
      this.#records.fits.set(site, fit);
    }
  }

  fitWritten(found: Type, expected: Type, at: AnchoredSpan): Fit {
    return this.#fitOf(found, expected, at);
  }

  /** How `found` fits `expected`; as it is after reporting a mismatch at `at`. */
  #fitOf(found: Type, expected: Type, at: AnchoredSpan): Fit {
    const fit = this.checker.fitOf(found, expected);
    if (fit === undefined) {
      this.#mismatch(found, expected, at);
    }
    return fit ?? exactFit;
  }

  fitUnwrapped(found: Type, expected: Type, at: AnchoredSpan): void {
    const fit = this.checker.fitOf(found, expected);
    if (fit === undefined || !isExact(fit)) {
      this.#mismatch(found, expected, at);
    }
  }

  /**
   * Reports why `found` doesn't fit: a trait it doesn't meet, when an `any` type is expected, or
   * that it converts into several members of the union expected (§2).
   */
  #mismatch(found: Type, expected: Type, at: AnchoredSpan): void {
    if (
      expected.kind === 'any' &&
      reportUnmet(useSite(this.checker, this.module, at), found, expected)
    ) {
      return;
    }
    this.report(misfitOf(this.checker.fitting, at, found, expected));
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

  recordField(name: Identifier, field: FieldMember): void {
    this.#records.namedFields.set(name, field);
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
