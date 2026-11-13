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
 * - An expression checked in a constraint scope (wiring/body/constraint-scope.ts, body-scopes.ts)
 *   is recorded again once the scope settles, its type solved; one the scope postpones is its
 *   placeholder until then (constructs/expressions/postponed.ts). A value where a union is expected
 *   is checked as the member it is built as when that is decided before it is checked (§2,
 *   `memberBuilt`); otherwise it goes in as fitting puts it, converted where its parts need.
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
import type { Expression, FieldHeader } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { Block, Statement, VariableDeclaration } from '../../../syntax/statements/index.ts';
import type { Identifier, Invalid } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { SignatureParameter } from '../../check.ts';
import { rootScope } from '../../constructs/closures/function-scope.ts';
import { FunctionScopes } from '../../constructs/closures/functions.ts';
import { inferLambda } from '../../constructs/closures/lambdas.ts';
import { declareOwnCall } from '../../constructs/closures/own-calls.ts';
import { ReturnScope } from '../../constructs/closures/returns.ts';
import { ValueCalls } from '../../constructs/closures/value-calls.ts';
import { FieldReads } from '../../constructs/expressions/access/member-access.ts';
import { OptionalChains } from '../../constructs/expressions/access/optionals.ts';
import { CollectionForms } from '../../constructs/expressions/collections/collections.ts';
import { expressionHandlers } from '../../constructs/expressions/expressions.ts';
import { memberBuilt, postponed, postponedAdmits } from '../../constructs/expressions/postponed.ts';
import { StructLiterals } from '../../constructs/expressions/structs/literal-sources.ts';
import { Iterations } from '../../constructs/loops/iteration.ts';
import { CheckedPatterns } from '../../constructs/patterns/matching.ts';
import { declareParameter, declareTargets } from '../../constructs/patterns/targets.ts';
import { LabelTargets } from '../../constructs/statements/loops.ts';
import { checkBlock, statementHandlers } from '../../constructs/statements/statements.ts';
import { VariableScope } from '../../constructs/statements/variables.ts';
import type {
  BodyContext,
  CheckedPasses,
  Enclosing,
  Returns,
} from '../../contexts/body-context.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { FieldPassType, PassTable } from '../../contexts/passes.ts';
import { Passes } from '../../contexts/passes.ts';
import { Desugarings } from '../../desugaring/index.ts';
import { handledBy } from '../../resolution/applying/call-kinds.ts';
import { ImplicitCalls } from '../../resolution/applying/implicit.ts';
import { CallRecords } from '../../resolution/calls/call-records.ts';
import { blockTail } from '../../rules/agreement.ts';
import { recordOutcomeCodecs } from '../../rules/boundary/outcome-codecs.ts';
import { checkDisposeUses } from '../../rules/disposal/disposal.ts';
import { checkDropped } from '../../rules/disposal/dropped.ts';
import type { FlowRoot } from '../../rules/flow/build/index.ts';
import { FlowDecisions } from '../../rules/flow/flow-decisions.ts';
import { freshLiteralOf } from '../../rules/placeholders.ts';
import { checkTestingCalls } from '../../rules/testing.ts';
import { statementPlace } from '../../surface/checked-annotation.ts';
import {
  type CheckedBody,
  type CoreExpression,
  type FieldGiver,
  isSugar,
  type ValueSite,
} from '../../surface/checked-body.ts';
import { type Admits, collectionTarget } from '../../types/fitting/expected.ts';
import { type Fit, isExact } from '../../types/fitting/fit/index.ts';
import { unfolded } from '../../types/type/computed-types.ts';
import type { FieldMember, FunctionType, Type } from '../../types/type/index.ts';
import { errorType, unitType } from '../../types/type/primitives.ts';
import { keysOwner } from '../../types/written/key-types.ts';
import { type BodyKind, ownScopeOf } from './body-kinds.ts';
import { bodyRecords } from './body-records.ts';
import { BodyScopes, closed } from './body-scopes.ts';
import { checkedAt } from './facts/index.ts';
import { reportedFit } from './reported-fits.ts';

export class BodyChecker implements BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  /** The passes field loops are checked in; every record of a node below is kept per pass. */
  readonly #passes = new Passes();
  readonly variables = new VariableScope(this.#passes, (type) =>
    handledBy(this.checker, this.functions.current, type),
  );
  readonly functions: FunctionScopes;
  readonly literals = new StructLiterals(this.#passes);
  readonly implicit = new ImplicitCalls(this.#passes);
  readonly calls = new CallRecords(this.#passes);
  readonly decisions = new FlowDecisions(this.#passes);
  readonly collections = new CollectionForms(this.#passes);
  readonly valueCalls = new ValueCalls(this.#passes);
  readonly iterations = new Iterations(this.#passes);
  readonly patterns = new CheckedPatterns(this.#passes);
  readonly chains = new OptionalChains(this.#passes);
  readonly fieldReads = new FieldReads(this.#passes);
  readonly labels = new LabelTargets();
  readonly #records = bodyRecords(this.#passes);
  readonly sugars = new Desugarings(this.#passes);
  /** The body's own result, which only the body's own function returns into. */
  readonly #result: ReturnScope;
  readonly scopes: BodyScopes;

  constructor(checker: CheckerContext, module: ModuleId, kind: BodyKind) {
    this.checker = checker;
    this.module = module;
    this.scopes = new BodyScopes({
      record: (node, type) => {
        this.#record(node, type);
      },
      decidesItems: (expected) => collectionTarget(checker, expected) !== undefined,
      here: () => {
        const { frames } = this.functions;
        const words = this.sugars.here();
        return (work) => words(() => this.functions.within(frames, work));
      },
    });
    const isFunction = kind.kind === 'function';
    this.#result = new ReturnScope(kind.declaredResult, isFunction);
    const root = rootScope(ownScopeOf(this.checker, kind), this.#result);
    this.functions = new FunctionScopes(root, this.#passes);
  }

  get inAsync(): boolean {
    return this.functions.current.isAsync;
  }

  get codeKind(): Type {
    return this.functions.current.codeKind;
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
    const result = this.#result.result(this, blockTail(body, tail));
    return this.#finished([{ root: body, parameters }], result);
  }

  /**
   * What checking a function's default `values` found (signatures.ts), once they are all checked,
   * each with the parameters before it, which it sees.
   */
  defaults(values: readonly FlowRoot[]): CheckedBody {
    return this.#finished(values, unitType);
  }

  /** Checks a value of its own, such as a constant's initializer, against the declared result. */
  checkValue(node: Expression): CheckedBody {
    const { declared } = this.#result;
    const type = this.expect(node, declared);
    return this.#finished([{ root: node, parameters: [] }], declared ?? type);
  }

  /** Checks a top-level constant (§3): its initializer as `checkValue` does, then its targets. */
  checkConstant(declaration: VariableDeclaration): CheckedBody {
    const { declared } = this.#result;
    const type = this.expect(declaration.initializer, declared);
    const value = declared ?? type;
    declareTargets(this, declaration, value);
    return this.#finished([{ root: declaration.initializer, parameters: [] }], value);
  }

  /**
   * The body checked from `roots`, each taking its parameters, after the rules over a whole body
   * ran on it: those over its calls, then those over its flow (rules/flow/).
   */
  #finished(roots: readonly FlowRoot[], result: Type): CheckedBody {
    this.variables.warnUnchanged(this);
    const calls = this.calls.entries();
    checkDisposeUses(this, calls, checkTestingCalls(this, calls));
    recordOutcomeCodecs(this, calls);
    const inputs = {
      checker: this.checker,
      module: this.module,
      localBodyOf: (declaration: FunctionDeclaration) =>
        this.checker.inputs.bodyOf(this.module, declaration),
    };
    const recorded = { records: this.#records, units: this, result, flows: { inputs, roots } };
    const body = checkedAt(recorded, this.#passes.root);
    for (const { root } of roots) {
      checkDropped(this, body.flowOf(root));
    }
    return body;
  }

  admitsOf(node: Expression): Admits | undefined {
    return postponedAdmits(this, node);
  }

  expression(node: Expression, given?: Type): Type {
    return this.sugars.checking(node, () => {
      if (isSugar(node)) {
        return this.sugars.check(this, node, given);
      }
      const admits = postponedAdmits(this, node);
      const type = this.scopes.checking(
        node,
        given,
        (expected) => this.#checked(node, expected, admits),
        admits !== undefined,
      );
      return this.#records.types.get(node) ?? type;
    });
  }

  settled(node: Expression, expected?: Type): Type {
    return this.scopes.suspended(() => this.expression(node, expected));
  }

  expectSettled(node: Expression, expected: Type): Type {
    return this.scopes.suspended(() => this.expect(node, expected));
  }

  /** Checks `node` by its kind's handler, in whatever scope is current. */
  part(node: Expression, given?: Type): Type {
    const fresh = freshLiteralOf(this, node, given === undefined ? undefined : unfolded(given));
    return fresh === undefined ? this.expression(node, given) : this.#record(node, fresh);
  }

  #checked(node: CoreExpression, given: Type | undefined, admits: Admits | undefined): Type {
    const expected = given === undefined ? undefined : unfolded(given);
    const isSettled = expected !== undefined && !this.scopes.holds(expected);
    if (admits !== undefined && this.scopes.isOpen && !isSettled) {
      const check = (known: Type | undefined) => this.#checkedAs(node, known, admits);
      return this.#record(node, postponed(this, node, { admits, expected, check }));
    }
    return this.#checkedAs(node, expected, admits);
  }

  /**
   * Checks `node` by its kind's handler where `expected`, of a union the member `admits` takes,
   * recording it.
   */
  #checkedAs(node: CoreExpression, expected: Type | undefined, admits: Admits | undefined): Type {
    if (expected !== undefined) {
      this.#expected(node, expected);
      if (node.kind === 'StringLiteral') {
        this.recordKey(node, keysOwner(this.checker.fitting, expected));
      }
    }
    const guide = memberBuilt(this, node, expected, admits);
    const handle = () => handlerOf(expressionHandlers, node)(this, node, guide);
    return this.#record(node, this.scopes.handling(node, guide, handle));
  }

  inferLambda(
    node: Expression,
    parameters: Pick<FunctionType, 'parameters' | 'pack'>,
    guide?: Type,
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
    this.#keep(this.#records.types, node, type);
    return type;
  }

  /** Records that `expected` is what `site` is expected to be, solved once its scope is. */
  #expected(site: ValueSite, expected: Type): void {
    this.#keep(this.#records.expected, site, expected);
  }

  /** Keeps `type` for `key`, solved once its scope is, as the function checked handles it. */
  #keep<K>(table: Pick<PassTable<K, Type>, 'set'>, key: K, type: Type): void {
    const frame = this.functions.current;
    const kept = (each: Type) => table.set(key, handledBy(this.checker, frame, each));
    kept(type);
    this.scopes.recorded(type, kept);
  }

  typeOf(node: Expression): Type {
    return this.checkedTypeOf(node) ?? errorType;
  }

  checkedTypeOf(node: Expression): Type | undefined {
    const core = isSugar(node) ? this.sugars.coreOf(node) : undefined;
    return this.#records.types.get(core ?? node);
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
    // What is still open in the constraint scope is fitted once it settles, as it is then.
    if (this.scopes.holds(found) || this.scopes.holds(expected)) {
      this.scopes.whenSolved((solved) => this.fit(solved(found), solved(expected), site, at));
      return;
    }
    this.#expected(site, expected);
    const fit = reportedFit(this, found, expected, { at, site });
    if (!isExact(fit)) {
      this.#records.fits.set(site, fit);
    }
  }

  fitWritten(found: Type, expected: Type, at: AnchoredSpan): Fit {
    return reportedFit(this, found, expected, { at });
  }

  block(node: Block, expected?: Type): Type {
    return checkBlock(this, node, { kind: 'value', expected });
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
    const worded = this.sugars.worded(this, diagnostic);
    if (!this.#passes.hold(worded)) {
      this.checker.report(this.module, worded);
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

  fieldPasses(
    header: FieldHeader,
    passes: readonly FieldPassType[],
    check: (pass: FieldPassType) => void,
  ): CheckedPasses {
    // Each pass checks the same text again, so what it checks settles before the pass exits: a
    // scope it joined would settle once every pass had left, writing into none of them.
    const { checked, inEach } = this.#passes.checkEach(
      passes,
      (pass) => this.scopes.suspended(() => check(pass)),
      (diagnostic) => this.report(diagnostic),
    );
    this.#records.fieldPasses.set(header, checked);
    return {
      inEach: (run) => inEach((pass, index) => this.scopes.suspended(() => run(pass, index))),
    };
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

  recordVariant(name: Identifier, variant: VariantEntity): void {
    this.#records.chosenVariants.set(name, variant);
  }

  chosenVariantOf(name: Identifier): VariantEntity | undefined {
    return this.#records.chosenVariants.get(name);
  }
}
