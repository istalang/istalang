/**
 * The context one function body is checked in, as interfaces, so per-construct modules depend on
 * these and never on each other or on the class implementing them (body-checker.ts).
 *
 * - `BodyContext` checks one body: it records every expression's type and every call's target for
 *   lowering (CheckedBody), and asks program-wide questions of its `CheckerContext` (context.ts).
 * - The facts a body's own rules gather live in per-concern units beside those rules (variables,
 *   returns, loops), each declared here as the narrow interface construct modules use, so a
 *   feature adds a unit, not methods on the context. As the body's contract, it names nothing
 *   above the type model but inference, whose constraint scopes a body holds (scopes.ts), and only
 *   what checks a body imports it, never the type model (.dependency-cruiser.mjs).
 */

import type { Entity, VariableEntity, VariantEntity } from '../../binder/entities.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import type {
  ArrayLiteral,
  Expression,
  FieldLoopHeader,
  FieldsLiteral,
  MapLiteral,
} from '../../syntax/expressions/index.ts';
import type { Pattern, PatternPart } from '../../syntax/patterns.ts';
import type {
  Assignment,
  Block,
  Break,
  Continue,
  Hold,
  LabelledScope,
  Loop,
  Return,
  Statement,
} from '../../syntax/statements/index.ts';
import type { Identifier, Invalid, NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { TypeNode } from '../../syntax/types/index.ts';
import type { SignatureParameter } from '../check.ts';
import type {
  AssignedPart,
  ChainLink,
  CheckedFunction,
  CollectionForm,
  CoreExpression,
  FieldGiver,
  FieldSource,
  Iteration,
  IterationForm,
  LabelResolution,
  NestedFunction,
  Sugar,
  ValueSite,
} from '../surface/checked-body.ts';
import type { FieldRead, FieldReading } from '../surface/checked-field.ts';
import type {
  CheckedPattern,
  FieldsPattern,
  TargetBinding,
  TargetOwner,
} from '../surface/checked-pattern.ts';
import type {
  Binding,
  FunctionNaming,
  ImplicitRole,
  ResolvedCall,
  ResolvedSite,
} from '../surface/resolved-call.ts';
import type { Admits } from '../types/fitting/expected.ts';
import type { Fit } from '../types/fitting/fit/index.ts';
import type { FieldMember, FunctionType, Type } from '../types/type/index.ts';
import type { CheckedModule } from './context.ts';
import type { FieldPassType } from './passes.ts';
import type { Scopes } from './scopes.ts';

export interface BodyContext extends CheckedModule {
  /**
   * Checks `node`, recording its type; `expected` guides inference but isn't enforced. It is checked
   * in the current constraint scope, or in one of its own, or in none, as its kind stands
   * (wiring/body/scope-protocol.ts).
   */
  readonly expression: (node: Expression, expected?: Type) => Type;
  /**
   * Checks `node` as `expression` does where no scope is current, as a part read at once is (a
   * callee, a condition, a subject): its type, settled.
   */
  readonly settled: (node: Expression, expected?: Type) => Type;
  /** Checks `node` as `expect` does where no scope is current, as a condition is: its type, settled. */
  readonly expectSettled: (node: Expression, expected: Type) => Type;
  /** The body's constraint scopes, and the one current (scopes.ts). */
  readonly scopes: Scopes;
  /**
   * What `node` can be a value of, when a constraint scope checks it only once it knows what is
   * expected of it (constructs/expressions/postponed.ts); undefined for one with a type of its own.
   */
  readonly admitsOf: (node: Expression) => Admits | undefined;
  /**
   * Checks `node`, a lambda, maybe parenthesized, recording its type, where its parameters' types
   * are known and its result is left for its body to decide (§8.1), `guide`, what is known of the
   * result, guiding the body as its expected type, if given.
   */
  readonly inferLambda: (
    node: Expression,
    parameters: Pick<FunctionType, 'parameters' | 'pack'>,
    guide?: Type,
  ) => Type;
  /** The type `node` was checked to have; the error type for a node not checked yet. */
  readonly typeOf: (node: Expression) => Type;
  /** The type `node` was checked to have; undefined for a node not checked yet. */
  readonly checkedTypeOf: (node: Expression) => Type | undefined;
  /** Records that `expected` is what `site` will be expected to be, as a call being written says. */
  readonly expectAt: (site: Expression, expected: Type) => void;
  /**
   * Records `type` as what `node` gives, read as a part of another construct rather than checked on
   * its own: a method call's callee, the value its field holds or its getter gives.
   */
  readonly recordType: (node: Expression, type: Type) => void;
  /** Checks `node` and, when a type is expected, reports when its type doesn't fit it. */
  readonly expect: (node: Expression, expected: Type | undefined) => Type;
  /**
   * Reports at `at` (the site's own span when absent) when `found`, the type of what `site` gives,
   * doesn't fit `expected`. When it fits by converting the value, made async or wrapped into `T?`
   * (§4.1, §6.4), records the fit for lowering.
   */
  readonly fit: (found: Type, expected: Type, site: ValueSite, at?: AnchoredSpan) => void;
  /**
   * Reports at `at` when `found`, written to a place of `expected` by an assignment, doesn't fit
   * it; how the value is converted to fit (§4.1, §6.4), which the assignment records on its part.
   */
  readonly fitWritten: (found: Type, expected: Type, at: AnchoredSpan) => Fit;
  /** Checks a block in its own scope; its type is that of its last expression (§10.1). */
  readonly block: (node: Block, expected?: Type) => Type;
  /** Checks a block run only for its effects, such as a loop's body, discarding every value. */
  readonly effectBlock: (node: Block) => void;
  /** Checks a statement; its type, which only a block's last statement passes on (§10.1). */
  readonly statement: (node: Statement | Invalid, expected?: Type) => Type;
  /**
   * Checks `node` as a part of a value a joining composite builds, a tuple's element or a
   * `struct{…}`'s field (wiring/body/constraint-scope.ts): a literal stays fresh in the current scope,
   * its literal type where what it goes into holds one once the scope settles, else its base (§4.3).
   */
  readonly part: (node: Expression, expected?: Type) => Type;
  /** The type `node` denotes in this body's module, as the pass being checked reads it. */
  readonly resolveType: (node: TypeNode) => Type;
  /**
   * `type` as the pass being checked reads it: each key a loop over a type's keys around it
   * declares bound to the pass's (contexts/passes.ts).
   */
  readonly inPass: (type: Type) => Type;
  /**
   * Records `type` as what `node`, an expression naming a type where no value is read, denotes in
   * the pass being checked (wiring/body/written-types.ts), never as a value's type.
   */
  readonly recordWritten: (node: Expression, type: Type) => void;
  /** What `name` denotes, a query: for a name only asked about, declared, or checked elsewhere. */
  readonly entityOf: (name: Identifier) => Entity | undefined;
  /**
   * What `name`, used where it is written, denotes; a local variable used inside a nested function
   * is captured there (§6.4).
   */
  readonly useEntity: (name: Identifier) => Entity | undefined;
  /** The calls the body makes (resolution/calls/call-records.ts). */
  readonly calls: CallRecord;
  /**
   * Records the field `giver` gives: a name in a struct literal, a pattern or an assignment's
   * target, or a call pattern's argument by position (`FieldGiver`).
   */
  readonly recordField: (giver: FieldGiver, field: FieldMember) => void;
  /**
   * Records that `value`, when it is a String literal, is a key of the struct `owner` (§5.2 Key
   * types): where checking decides it, so tools read it as a name of that struct's field.
   */
  readonly recordKey: (value: Expression, owner: Type | undefined) => void;
  /**
   * Records the literal the indented value `value` was checked as
   * (constructs/expressions/literals/indented-values.ts).
   */
  /** Records the variant the bare name `name` chose (types/written/named-types.ts). */
  readonly recordVariant: (name: Identifier, variant: VariantEntity) => void;
  /** The variant the bare name `name` chose; undefined for one not checked yet or naming none. */
  readonly chosenVariantOf: (name: Identifier) => VariantEntity | undefined;
  /** The sugars the body desugars, and the operands they checked (checker/desugaring/). */
  readonly sugars: Sugars;
  /** What the body's checking decided of which of its code runs (rules/flow/flow-decisions.ts). */
  readonly decisions: DecisionRecord;
  /**
   * Runs `check` once per pass of the field loop `header` heads (§11.2), each pass's records of nodes
   * kept apart (passes.ts), so the body reads as each pass checked it; what is decided of every
   * pass together is then recorded back in each (`CheckedPasses`). Each pass checks the same text
   * again, so what it checks settles before the pass exits: a scope it joined would settle once
   * every pass had left, writing into none of them.
   */
  readonly fieldPasses: (
    header: FieldLoopHeader,
    passes: readonly FieldPassType[],
    check: (pass: FieldPassType) => void,
  ) => CheckedPasses;
  /** Whether the innermost function is async, the only kind that may `await` (§14). */
  readonly inAsync: boolean;
  /** The kind of the innermost function's code (proposal 8, Rule 2). */
  readonly codeKind: Type;
  readonly variables: Variables;
  readonly literals: LiteralSources;
  /** The functions being checked, the body's own and nested ones (§6.4), innermost current. */
  readonly functions: Functions;
  /** The innermost function's result. */
  readonly returns: Returns;
  /** The innermost function's loops and labelled blocks. */
  readonly enclosing: Enclosing;
  readonly implicit: ImplicitRecord;
  readonly collections: CollectionRecord;
  readonly valueCalls: ValueCallRecord;
  readonly iterations: IterationRecord;
  readonly patterns: PatternRecord;
  readonly chains: Chains;
  readonly fieldReads: FieldReadRecord;
  /** What this body's exits and holds name, recorded as it is checked. */
  readonly labels: LabelRecord;
}

/**
 * A field loop's passes once checked (§11.2): `inEach` runs back in each pass, in order, what is
 * decided of all of them together, such as the type their values agree on or the type arguments
 * they infer, recording and reporting it as that pass's.
 */
export interface CheckedPasses {
  readonly inEach: (run: (pass: FieldPassType, index: number) => void) => void;
}

/** A body's variables: types, uses, and what targets take (constructs/statements/variables.ts). */
export interface Variables {
  readonly declare: (name: Identifier, type: Type) => void;
  readonly declareParameter: (
    parameter: Pick<SignatureParameter, 'node' | 'type' | 'reference'>,
  ) => void;
  /** Whether `variable` is a parameter taking a reference (§7.3). */
  readonly isReference: (variable: VariableEntity) => boolean;
  /** Whether `variable` may change: a `let`, or a parameter taking a reference. */
  readonly isChangeable: (variable: VariableEntity) => boolean;
  readonly typeOf: (variable: VariableEntity) => Type;
  /** Notes that `variable` was reassigned, or changed in part. */
  readonly noteChanged: (variable: VariableEntity) => void;
  /**
   * Notes that `variable` lives in a cell: passed by `&`, which needs storage a reference can reach,
   * a `let` a closure captures, sharing its storage (§6.4), or a transient, which the calls nested
   * in its function share (§7.1).
   */
  readonly noteInCell: (variable: VariableEntity) => void;
  readonly recordTargets: (owner: TargetOwner, bindings: readonly TargetBinding[]) => void;
  readonly recordAssigned: (assignment: Assignment, parts: readonly AssignedPart[]) => void;
}

/**
 * Where each struct literal's fields get values
 * (constructs/expressions/structs/literal-fields/index.ts).
 */
export interface LiteralSources {
  readonly record: (literal: FieldsLiteral, sources: readonly FieldSource[]) => void;
  /** Records the fields `literal` builds, typed by the type arguments found for it. */
  readonly recordFields: (literal: FieldsLiteral, fields: readonly FieldMember[]) => void;
}

/** What checking keeps of the sugars a body desugars (checker/desugaring/index.ts). */
export interface Sugars {
  /** Checks `node` as the core tree it means where it stands, recording it (`coreOf`). */
  readonly check: (context: BodyContext, node: Sugar, expected: Type | undefined) => Type;
  /**
   * Checks `node`, a sugar's written operand, settled, before the core tree holding it, against
   * `expected` if given: checking the core reads this type of it, checking it no more, or the error
   * type when it doesn't fit `expected`, which was reported.
   */
  readonly operand: (context: BodyContext, node: Expression, expected?: Type) => Type;
  /**
   * Records the core tree `node` is checked as: a sugar's, or the core call a written call a sugar
   * makes was rebuilt as.
   */
  readonly record: (node: Expression, core: CoreExpression) => void;
  /** The core tree recorded for `node`; undefined for a node no desugaring rebuilt. */
  readonly coreOf: (node: Expression) => CoreExpression | undefined;
}

/** The functions a body is checked in, innermost current (constructs/closures/functions.ts). */
export interface Functions {
  readonly current: FunctionFrame;
  /** The functions being checked, outermost first, as `within` takes them back. */
  readonly frames: readonly FunctionFrame[];
  /**
   * Runs `check` inside `frames` again, as a constraint scope checks what it postponed inside the
   * functions it was written in (wiring/body/constraint-scope.ts).
   */
  readonly within: <Result>(frames: readonly FunctionFrame[], check: () => Result) => Result;
  /** Runs `check` inside `scope`; while its type isn't known, using its own name is reported. */
  readonly inside: <Result>(scope: FunctionFrame, check: () => Result) => Result;
  /** Notes that `entity` is used where `name` is written, capturing it where it must be. */
  readonly noteUse: (context: BodyContext, name: Identifier, entity: VariableEntity) => void;
  /** The type of a local function or named lambda used by `name`, or the error after a report. */
  readonly typeOfFunction: (context: BodyContext, name: Identifier, entity: VariableEntity) => Type;
  readonly record: (node: NestedFunction, checked: CheckedFunction) => void;
  readonly checkedOf: (node: NestedFunction) => CheckedFunction | undefined;
}

/** A variable a function captures, and where it first uses it. */
export interface CapturedUse {
  readonly entity: VariableEntity;
  readonly site: Identifier;
}

/**
 * One function being checked: the body's own, or a nested one
 * (constructs/closures/function-scope.ts).
 */
export interface FunctionFrame {
  /** The function checked: the body's own declaration, or a nested one; none for a value's body. */
  readonly function: NestedFunction | undefined;
  /**
   * What a nested function's text covers, header and body: the names declared there are its own.
   * None for the body's own function, every local name of which is its own.
   */
  readonly reach: AnchoredSpan | undefined;
  readonly isAsync: boolean;
  /** The kind of its code, which every function it calls must allow (proposal 8, Rule 2). */
  readonly codeKind: Type;
  /**
   * Whether its code depended on its kind: called or waited on something of a kind, or fixed a
   * function's kind by it. A plain lambda that didn't is of either kind (proposal 8, Rule 2).
   */
  readonly reliesOnKind: boolean;
  /** Notes that its code depends on its kind. */
  readonly relyOnKind: () => void;
  readonly returns: Returns;
  readonly enclosing: Enclosing;
  /** The variables the function captures, by the name each declares, in the order first used. */
  readonly captures: ReadonlyMap<Identifier, CapturedUse>;
  /** Notes that the function captures `entity`, used where `site` is written. */
  readonly capture: (entity: VariableEntity, site: Identifier) => void;
  /** Whether a `select` case watching this function's own call encloses what is checked (§16). */
  readonly inCleanup: boolean;
  /** Runs `check` inside a case that cleans up after this function's call is disposed. */
  readonly cleanup: <Result>(check: () => Result) => Result;
}

/**
 * One function's result: declared, or gathered from its `return`s (constructs/closures/returns.ts).
 */
export interface Returns {
  readonly declared: Type | undefined;
  /** Checks a `return` and what it returns: its value, or `Unit` for a bare one. */
  readonly check: (context: BodyContext, node: Return) => void;
  /** Notes a `?` at `span` that would return an `Err` of `error` (§12). */
  readonly propagate: (context: BodyContext, error: Type, span: AnchoredSpan) => void;
}

/**
 * The loops and labelled blocks around what one function checks
 * (constructs/closures/enclosing-scopes.ts).
 */
export interface Enclosing {
  /** Runs `check` inside the body of `scope`. */
  readonly inside: <Result>(scope: LabelledScope, check: () => Result) => Result;
  /** The innermost loop around: what a `break` or `continue` with no label leaves. */
  readonly innermostLoop: Loop | undefined;
  /** The innermost scope around labelled `name`. */
  readonly labelled: (name: Identifier) => LabelledScope | undefined;
  /** Whether `name` is the function's own, which `hold(name)` also names. */
  readonly isOwnName: (name: Identifier) => boolean;
}

/** The calls a body makes (resolution/calls/call-records.ts). */
export interface CallRecord {
  readonly record: (site: ResolvedSite, call: ResolvedCall) => void;
  /** The call recorded at `site`; undefined for one not checked yet or that couldn't be made. */
  readonly of: (site: ResolvedSite) => ResolvedCall | undefined;
  /** Records the function `naming` names as a value (§6.4), which calls nothing yet. */
  readonly recordValue: (naming: FunctionNaming, named: ResolvedCall) => void;
  /** The function `naming` names as a value; undefined where it names none. */
  readonly valueOf: (naming: FunctionNaming) => ResolvedCall | undefined;
  /** Records the functions the call at `site` chooses among (resolution/calls/resolve/index.ts). */
  readonly recordCandidates: (
    site: ResolvedSite,
    candidates: readonly FunctionDeclaration[],
  ) => void;
}

/** What checking decides of which code of a body runs (rules/flow/flow-decisions.ts). */
export interface DecisionRecord {
  /**
   * Records that `body`, a branch or a case, never runs: a condition decided by types rules it out
   * (constructs/expressions/operators/decided-conditions.ts), so it is neither checked nor lowered.
   */
  readonly ruleOut: (body: Block) => void;
  /** Records that `operation` never runs past `operands`, the last of which has no value (§4.1). */
  readonly stopAt: (operation: Expression | Assignment, operands: readonly Expression[]) => void;
  /**
   * Records the value `condition` always has, by its operands' types
   * (constructs/expressions/operators/decided-conditions.ts).
   */
  readonly decide: (condition: Expression, value: boolean) => void;
  /**
   * The value `node`, a comparison, `is` or condition, was decided to always have; else undefined.
   */
  readonly decidedAt: (node: Expression) => boolean | undefined;
}

/**
 * The calls the language makes for constructs with no call written
 * (resolution/applying/implicit.ts).
 */
export interface ImplicitRecord {
  readonly record: (node: NodeOf<string>, role: ImplicitRole, call: ResolvedCall) => void;
  readonly of: (node: NodeOf<string>, role: ImplicitRole) => ResolvedCall | undefined;
}

/** What each collection literal builds (constructs/expressions/collections/collections.ts). */
export interface CollectionRecord {
  readonly record: (literal: ArrayLiteral | MapLiteral, form: CollectionForm) => void;
}

/** The calls of function values (constructs/closures/value-calls.ts, §6.4). */
export interface ValueCallRecord {
  /** Records that `node` calls a function value, its arguments not judged yet. */
  readonly record: (node: Call) => void;
  /** Records how `node`'s arguments fill the value's parameters, as judging them bound them. */
  readonly bind: (node: Call, binding: Binding) => void;
  readonly has: (node: Call) => boolean;
}

/** How each iteration runs (constructs/loops/iteration.ts). */
export interface IterationRecord {
  readonly record: (iteration: Iteration, form: IterationForm) => void;
  /** The form recorded for `iteration`; undefined for one not checked to run, its value having none. */
  readonly formOf: (iteration: Iteration) => IterationForm | undefined;
}

/**
 * How each field read reaches its field (constructs/expressions/access/member-access.ts), which a
 * place reaching it asks again: a field a key reads is a place's field, never an element
 * (resolution/calls/places.ts).
 */
export interface FieldReadRecord {
  readonly record: (reading: FieldReading, read: FieldRead) => void;
  readonly of: (reading: FieldReading) => FieldRead | undefined;
}

/**
 * Each pattern's tests and bindings, the type each pattern and part was matched against, and the
 * fields a struct or call pattern names (constructs/patterns/matching.ts).
 */
export interface PatternRecord {
  readonly record: (pattern: Pattern, checked: CheckedPattern) => void;
  readonly recordMatched: (node: Pattern | PatternPart, type: Type) => void;
  readonly recordFields: (pattern: FieldsPattern, fields: readonly FieldMember[]) => void;
}

/** The links of optional chains (constructs/expressions/access/optionals.ts). */
export interface Chains {
  /**
   * Checks the target of `link`'s step; the type the step works on: the value a chained target
   * carries, the value inside an optional after `?.`, or the error type after a report.
   */
  readonly target: (context: BodyContext, link: Expression) => Type;
  readonly chainOf: (link: Expression) => ChainLink | undefined;
  /** Whether `node`, its target checked, continues an optional chain, which its value then ends. */
  readonly continues: (node: Expression) => boolean;
}

/** What each exit and hold names, recorded as constructs/statements/loops.ts resolves it. */
export interface LabelRecord extends LabelResolution {
  readonly recordExit: (exit: Break | Continue, target: LabelledScope) => void;
  readonly recordHold: (hold: Hold, target: LabelledScope) => void;
  /** Whether some exit or hold names `scope` by its label. */
  readonly isNamed: (scope: LabelledScope) => boolean;
}
