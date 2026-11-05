/**
 * Checking one function body (§2–§4): the BodyContext every expression and statement handler
 * works through, and the CheckedBody lowering reads afterwards.
 *
 * - Types flow both ways: a handler receives the type its context expects (bidirectional
 *   inference), and reports against it only where the spec says a value must fit (`expect`, or
 *   `fit` for a type already checked). Every type mismatch is reported through `fit`.
 * - What lowering needs is recorded as checking goes: every expression's type, every call's
 *   target, and every value's implicit conversions (§2, types/fit.ts), which `fit` finds: on the
 *   node giving the value, or, for a value an assignment writes, on its part
 *   (statements/assignments.ts).
 *   Nothing is recomputed later, so lowering sees exactly what was checked.
 * - The facts the body's rules gather (variables, the functions it nests, struct literals) are
 *   units of their own, beside those rules; this class only composes them. What they record of a
 *   node is kept per pass of a field loop (passes.ts), so the body reads as each pass checked it. A lambda or local
 *   function is checked in this same body, in a function scope of its own (closures/), so its
 *   result, loops and asyncness are the innermost scope's, and a name used in it is captured
 *   where it is used (`useEntity`).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { handlerOf } from '../../structures/kind-table.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Entity, VariantEntity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Call, Expression, FieldHeader } from '../syntax/expressions/index.ts';
import type { Identifier, Invalid } from '../syntax/node.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Block, Statement, VariableDeclaration } from '../syntax/statements.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { Accepts, BodyContext, CheckedPasses, Enclosing, Returns } from './body-context.ts';
import type { CheckedBody, FieldPassType, SignatureParameter, ValueSite } from './check.ts';
import { statementPlace } from './checked-annotation.ts';
import { FunctionScope } from './closures/function-scope.ts';
import { FunctionScopes } from './closures/functions.ts';
import { inferLambda } from './closures/lambdas.ts';
import { declareOwnCall } from './closures/own-calls.ts';
import { blockTail, ReturnScope } from './closures/returns.ts';
import type { CheckerContext } from './context.ts';
import { CollectionForms } from './expressions/collections.ts';
import { acceptedPartOf, acceptsOf, expressionHandlers } from './expressions/expressions.ts';
import { StructLiterals } from './expressions/literal-sources.ts';
import { FieldReads } from './expressions/member-access.ts';
import { OptionalChains } from './expressions/optionals.ts';
import { type Pass, Passes } from './passes.ts';
import { CheckedPatterns } from './patterns/matching.ts';
import { declareTargets } from './patterns/targets.ts';
import { ImplicitCalls } from './resolution/implicit.ts';
import { reportUnmet } from './resolution/trait-objects.ts';
import type { ResolvedCall, ResolvedSite } from './resolved-call.ts';
import { checkDisposeUses } from './rules/disposal.ts';
import { checkDropped } from './rules/dropped.ts';
import { Iterations } from './rules/iteration.ts';
import { checkTestingCalls } from './rules/testing-calls.ts';
import { LabelTargets } from './statements/loops.ts';
import { checkBlock, statementHandlers } from './statements/statements.ts';
import { VariableScope } from './statements/variables.ts';
import { memberBuilt } from './types/expected.ts';
import { exactFit, type Fit, isExact } from './types/fit.ts';
import { misfitOf } from './types/misfit.ts';
import {
  errorType,
  type FieldMember,
  type FunctionType,
  type Type,
  unitType,
} from './types/type.ts';
import { unfolded } from './types/type-match.ts';
import { useSite } from './use-site.ts';

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

/** A field loop's pass as checked: its key and value, and the pass its records are kept in. */
interface CheckedPass extends FieldPassType {
  readonly pass: Pass;
}

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
  readonly #types = this.#passes.table<Expression, Type>();
  readonly #expected = this.#passes.table<ValueSite, Type>();
  readonly #resolved = this.#passes.table<ResolvedSite, ResolvedCall>();
  readonly #valueCalls = this.#passes.table<Call, true>();
  readonly #candidates = this.#passes.table<ResolvedSite, readonly FunctionDeclaration[]>();
  readonly #namedFields = this.#passes.table<Identifier, FieldMember>();
  readonly #chosenVariants = this.#passes.table<Identifier, VariantEntity>();
  readonly #fits = this.#passes.table<ValueSite, Fit>();
  readonly #fieldPasses = this.#passes.table<FieldHeader, readonly CheckedPass[]>();
  /** The body's own result, which only the body's own function returns into. */
  readonly #result: ReturnScope;

  constructor(checker: CheckerContext, module: ModuleId, kind: BodyKind) {
    this.checker = checker;
    this.module = module;
    const isFunction = kind.kind === 'function';
    this.#result = new ReturnScope(kind.declaredResult, isFunction);
    const root = isFunction
      ? new FunctionScope(kind.declaration, kind.isAsync, this.#result)
      : new FunctionScope(undefined, false, this.#result);
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
      this.variables.declareParameter(parameter);
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
    const calls = this.#resolved.entries();
    checkDisposeUses(this, calls, checkTestingCalls(this, calls));
    return this.#checkedAt(this.#passes.root, result);
  }

  expression(node: Expression, given?: Type): Type {
    const expected = given === undefined ? undefined : unfolded(given, this.checker.typeRules);
    if (expected !== undefined) {
      this.#expected.set(node, expected);
    }
    const guide =
      expected === undefined ? undefined : memberBuilt(expected, node, () => this.accepts(node));
    return this.#record(node, handlerOf(expressionHandlers, node)(this, node, guide));
  }

  accepts(node: Expression): Accepts | undefined {
    return acceptsOf(this, node);
  }

  acceptedPart(node: Expression | undefined) {
    return acceptedPartOf(this, node);
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
    const type = this.chains.linked(this, node, unfolded(value, this.checker.typeRules));
    this.#types.set(node, type);
    return type;
  }

  typeOf(node: Expression): Type {
    return this.#types.get(node) ?? errorType;
  }

  callAt(site: ResolvedSite): ResolvedCall | undefined {
    return this.#resolved.get(site);
  }

  expect(node: Expression, expected: Type | undefined): Type {
    const type = this.expression(node, expected);
    if (expected !== undefined) {
      this.fit(type, expected, node);
    }
    return type;
  }

  fit(found: Type, expected: Type, site: ValueSite, at = site.span): void {
    this.#expected.set(site, expected);
    const fit = this.#fitOf(found, expected, at);
    if (!isExact(fit)) {
      this.#fits.set(site, fit);
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
    this.#resolved.set(site, call);
  }

  recordValueCall(node: Call): void {
    this.#valueCalls.set(node, true);
  }

  fieldPasses(
    header: FieldHeader,
    passes: readonly FieldPassType[],
    check: (pass: FieldPassType) => void,
  ): CheckedPasses {
    const { checked, inEach } = this.#passes.checkEach(passes, check, (diagnostic) =>
      this.report(diagnostic),
    );
    this.#fieldPasses.set(header, checked);
    return { inEach };
  }

  recordCandidates(site: ResolvedSite, candidates: readonly FunctionDeclaration[]): void {
    this.#candidates.set(site, candidates);
  }

  recordField(name: Identifier, field: FieldMember): void {
    this.#namedFields.set(name, field);
  }

  recordVariant(name: Identifier, variant: VariantEntity): void {
    this.#chosenVariants.set(name, variant);
  }

  /** The CheckedBody of what was checked as `pass` sees it, producing `result`. */
  #checkedAt(pass: Pass, result: Type): CheckedBody {
    const { variables, literals, implicit, functions, labels } = this;
    return {
      typeOf: (expression) => this.#types.get(expression, pass),
      expectedOf: (site) => this.#expected.get(site, pass),
      resolved: this.#resolved.at(pass),
      valueCalls: this.#valueCalls.at(pass),
      madeCalls: () => [
        ...this.#resolved.entries().map(([site, call]) => ({ site, call })),
        ...implicit.made(),
        ...literals.made(),
      ],
      implicitCallOf: (node, role) => implicit.of(node, role, pass),
      collectionFormOf: (literal) => this.collections.of(literal, pass),
      iterationOf: (iteration) => this.iterations.of(iteration, pass),
      fitAt: (site) => this.#fits.get(site, pass) ?? exactFit,
      targetsOf: (owner) => variables.targetsOf(owner, pass),
      assignedOf: (assignment) => variables.assignedOf(assignment, pass),
      inCell: (name) => variables.inCell(name),
      functionOf: (node) => functions.checkedOf(node, pass),
      sourcesOf: (literal) => literals.sourcesOf(literal, pass),
      literalFieldsOf: (literal) => literals.fieldsOf(literal, pass),
      patternOf: (pattern) => this.patterns.patternOf(pattern, pass),
      chainOf: (link) => this.chains.chainOf(link, pass),
      fieldReadOf: (access) => this.fieldReads.of(access, pass),
      declaredTypeOf: (name) => variables.declaredTypeOf(name, pass),
      namedFieldOf: (name) => this.#namedFields.get(name, pass),
      chosenVariantOf: (name) => this.#chosenVariants.get(name, pass),
      candidatesAt: (site) => this.#candidates.get(site, pass) ?? [],
      labels,
      passesOf: (header) =>
        (this.#fieldPasses.get(header, pass) ?? []).map(({ pass: inner, ...each }) => ({
          ...each,
          body: this.#checkedAt(inner, result),
        })),
      result,
    };
  }
}
