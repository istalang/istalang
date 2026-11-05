/**
 * The context one function body is checked in, as interfaces, so per-construct modules depend on
 * these and never on each other or on the class implementing them (body-checker.ts).
 *
 * - `BodyContext` checks one body: it records every expression's type and every call's target for
 *   lowering (CheckedBody), and asks program-wide questions of its `CheckerContext` (context.ts).
 * - The facts a body's own rules gather live in per-concern units beside those rules (variables,
 *   returns, loops), each declared here as the narrow interface construct modules use, so a
 *   feature adds a unit, not methods on the context, and this contract names nothing above the
 *   type model (.dependency-cruiser.mjs).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Entity, VariableEntity, VariantEntity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type {
  ArrayLiteral,
  Call,
  Expression,
  FieldHeader,
  FieldsLiteral,
  MapLiteral,
} from '../syntax/expressions/index.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
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
} from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type {
  AssignedPart,
  ChainLink,
  CheckedFunction,
  CollectionForm,
  FieldSource,
  Iteration,
  IterationForm,
  LabelResolution,
  NestedFunction,
  SignatureParameter,
  ValueSite,
} from './check.ts';
import type { FieldRead, FieldReading } from './checked-field.ts';
import type { CheckedPattern, TargetBinding, TargetOwner } from './checked-pattern.ts';
import type { CheckerContext } from './context.ts';
import type { FieldPassType } from './passes.ts';
import type { ImplicitRole, ResolvedCall, ResolvedSite } from './resolved-call.ts';
import type { Fit } from './types/fit.ts';
import type { FieldMember, FunctionType, Type } from './types/type.ts';

export interface BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  /** Checks `node`, recording its type; `expected` guides inference but isn't enforced. */
  readonly expression: (node: Expression, expected?: Type) => Type;
  /**
   * Which parameter types `node` can take when the call it is passed to decides its type (§3.5);
   * undefined when it has a type of its own, which takes part in choosing the function.
   */
  readonly accepts: (node: Expression) => Accepts | undefined;
  /** How `node` takes part in a composite argument's `Accepts` check (expressions.ts). */
  readonly acceptedPart: (node: Expression | undefined) => AcceptedPart;
  /**
   * Checks `node`, a lambda, maybe parenthesized, recording its type, where its parameters' types
   * are known and its result is left for its body to decide (§3.5).
   */
  readonly inferLambda: (
    node: Expression,
    parameters: Pick<FunctionType, 'parameters' | 'pack'>,
  ) => Type;
  /** The type `node` was checked to have; the error type for a node not checked yet. */
  readonly typeOf: (node: Expression) => Type;
  /** The call recorded at `site`; undefined for one not checked yet or that couldn't be made. */
  readonly callAt: (site: ResolvedSite) => ResolvedCall | undefined;
  /** Checks `node` and, when a type is expected, reports when its type doesn't fit it. */
  readonly expect: (node: Expression, expected: Type | undefined) => Type;
  /**
   * Reports at `at` (the site's own span when absent) when `found`, the type of what `site` gives,
   * doesn't fit `expected`. When it fits by converting the value, made async or wrapped into `T?`
   * (§2, §3.14), records the fit for lowering.
   */
  readonly fit: (found: Type, expected: Type, site: ValueSite, at?: AnchoredSpan) => void;
  /**
   * Reports at `at` when `found`, written to a place of `expected` by an assignment, doesn't fit
   * it; how the value is converted to fit (§2, §3.14), which the assignment records on its part.
   */
  readonly fitWritten: (found: Type, expected: Type, at: AnchoredSpan) => Fit;
  /**
   * Reports at `at` when the items of a spread, of `found`, don't fit `expected` as they are: the
   * spread gives its items as a whole, so none of them is wrapped (§2).
   */
  readonly fitUnwrapped: (found: Type, expected: Type, at: AnchoredSpan) => void;
  /** Checks a block in its own scope; its type is that of its last expression (§4). */
  readonly block: (node: Block, expected?: Type) => Type;
  /** Checks a block run only for its effects, such as a loop's body, discarding every value. */
  readonly effectBlock: (node: Block) => void;
  /** Checks a statement; its type, which only a block's last statement passes on (§4). */
  readonly statement: (node: Statement | Invalid, expected?: Type) => Type;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
  /** The type `node` denotes in this body's module. */
  readonly resolveType: (node: TypeNode) => Type;
  /** What `name` denotes, a query: for a name only asked about, declared, or checked elsewhere. */
  readonly entityOf: (name: Identifier) => Entity | undefined;
  /**
   * What `name`, used where it is written, denotes; a local variable used inside a nested function
   * is captured there (§3.14).
   */
  readonly useEntity: (name: Identifier) => Entity | undefined;
  readonly recordCall: (site: ResolvedSite, call: ResolvedCall) => void;
  /** Records the functions the call at `site` chooses among (calls/resolve.ts). */
  readonly recordCandidates: (
    site: ResolvedSite,
    candidates: readonly FunctionDeclaration[],
  ) => void;
  /** Records the field `name` names in a struct literal, a pattern or an assignment's target. */
  readonly recordField: (name: Identifier, field: FieldMember) => void;
  /** Records the variant the bare name `name` chose (resolution/named.ts). */
  readonly recordVariant: (name: Identifier, variant: VariantEntity) => void;
  /** Records that `node` calls a function value (§3.14). */
  readonly recordValueCall: (node: Call) => void;
  /**
   * Records that `body`, a branch or a case, never runs: a condition decided by types rules it
   * out (rules/decided-conditions.ts), so it is neither checked nor lowered.
   */
  readonly ruleOut: (body: Block) => void;
  /** Records that `operation` never runs past `operands`, the last of which has no value (§2). */
  readonly stopAt: (operation: Expression | Assignment, operands: readonly Expression[]) => void;
  /** Records the value `condition` always has, by its operands' types (rules/decided-conditions.ts). */
  readonly decide: (condition: Expression, value: boolean) => void;
  /**
   * Runs `check` once per pass of the field loop `header` heads (§4), each pass's records of nodes
   * kept apart (passes.ts), so the body reads as each pass checked it; what is decided of every
   * pass together is then recorded back in each (`CheckedPasses`).
   */
  readonly fieldPasses: (
    header: FieldHeader,
    passes: readonly FieldPassType[],
    check: (pass: FieldPassType) => void,
  ) => CheckedPasses;
  /** Whether the innermost function is async, the only kind that may `await` (§5). */
  readonly inAsync: boolean;
  readonly variables: Variables;
  readonly literals: LiteralSources;
  /** The functions being checked, the body's own and nested ones (§3.14), innermost current. */
  readonly functions: Functions;
  /** The innermost function's result. */
  readonly returns: Returns;
  /** The innermost function's loops and labelled blocks. */
  readonly enclosing: Enclosing;
  readonly implicit: ImplicitRecord;
  readonly collections: CollectionRecord;
  readonly iterations: IterationRecord;
  readonly patterns: PatternRecord;
  readonly chains: Chains;
  readonly fieldReads: FieldReadRecord;
  /** What this body's exits and holds name, recorded as it is checked. */
  readonly labels: LabelRecord;
}

/**
 * Whether an argument the chosen function decides can take a parameter of type `expected`, where
 * a part `isOpen` says inference hasn't found yet can be anything.
 */
export type Accepts = (expected: Type, isOpen: (part: Type) => boolean) => boolean;

/**
 * A field loop's passes once checked (§4): `inEach` runs back in each pass, in order, what is
 * decided of all of them together, such as the type their values agree on or the type arguments
 * they infer, recording and reporting it as that pass's.
 */
export interface CheckedPasses {
  readonly inEach: (run: (pass: FieldPassType, index: number) => void) => void;
}

/**
 * What one part of a composite argument has before the call is chosen: the parameter types it can
 * take when the call decides its type, or its own type when known without side effects, with, for
 * a literal of items each with a type of its own, the types its items can build it as instead
 * (§3.7).
 */
export type AcceptedPart =
  | { readonly kind: 'decided'; readonly accepts: Accepts }
  | {
      readonly kind: 'typed';
      readonly type: Type | undefined;
      readonly builds?: Accepts | undefined;
    };

/** A body's variables: types, uses, and what targets take (statements/variables.ts). */
export interface Variables {
  readonly declare: (name: Identifier, type: Type) => void;
  readonly declareParameter: (
    parameter: Pick<SignatureParameter, 'node' | 'type' | 'reference'>,
  ) => void;
  /** Whether `variable` is a parameter taking a reference (§3.7). */
  readonly isReference: (variable: VariableEntity) => boolean;
  /** Whether `variable` may change: a `let`, or a parameter taking a reference. */
  readonly isChangeable: (variable: VariableEntity) => boolean;
  readonly typeOf: (variable: VariableEntity) => Type;
  /** Notes that `variable` was reassigned, or changed in part. */
  readonly noteChanged: (variable: VariableEntity) => void;
  /** Notes that `variable` is passed by `&`, so it needs storage a reference can reach. */
  readonly noteReferenced: (variable: VariableEntity) => void;
  /** Notes that a closure captures `variable`, a `let`, so both share its storage (§3.14). */
  readonly noteCaptured: (variable: VariableEntity) => void;
  readonly recordTargets: (owner: TargetOwner, bindings: readonly TargetBinding[]) => void;
  readonly recordAssigned: (assignment: Assignment, parts: readonly AssignedPart[]) => void;
}

/** Where each struct or variant literal's fields get values (expressions/literal-fields.ts). */
export interface LiteralSources {
  readonly record: (literal: FieldsLiteral, sources: readonly FieldSource[]) => void;
  /** Records the fields `literal` builds, typed by the type arguments found for it. */
  readonly recordFields: (literal: FieldsLiteral, fields: readonly FieldMember[]) => void;
}

/** The functions a body is checked in, innermost current (closures/functions.ts). */
export interface Functions {
  readonly current: FunctionFrame;
  /** Runs `check` inside `scope`; while its type isn't known, using its own name is reported. */
  readonly inside: <Result>(scope: FunctionFrame, check: () => Result) => Result;
  /** Notes that `entity` is used where `name` is written, capturing it where it must be. */
  readonly noteUse: (context: BodyContext, name: Identifier, entity: VariableEntity) => void;
  /** The type of a local function or named lambda used by `name`, or the error after a report. */
  readonly typeOfFunction: (context: BodyContext, name: Identifier, entity: VariableEntity) => Type;
  readonly record: (node: NestedFunction, checked: CheckedFunction) => void;
  readonly checkedOf: (node: NestedFunction) => CheckedFunction | undefined;
}

/** One function being checked: the body's own, or a nested one (closures/function-scope.ts). */
export interface FunctionFrame {
  /** The function checked: the body's own declaration, or a nested one; none for a value's body. */
  readonly function: NestedFunction | undefined;
  /**
   * What a nested function's text covers, header and body: the names declared there are its own.
   * None for the body's own function, every local name of which is its own.
   */
  readonly reach: AnchoredSpan | undefined;
  readonly isAsync: boolean;
  readonly returns: Returns;
  readonly enclosing: Enclosing;
  /** What the function captures, in the order first used. */
  readonly captures: ReadonlyMap<Identifier, VariableEntity>;
  /** Notes that the function captures `entity`. */
  readonly capture: (entity: VariableEntity) => void;
  /** Whether a `select` case watching this function's own call encloses what is checked (§7). */
  readonly inCleanup: boolean;
  /** Runs `check` inside a case that cleans up after this function's call is disposed. */
  readonly cleanup: <Result>(check: () => Result) => Result;
}

/** One function's result: declared, or gathered from its `return`s (closures/returns.ts). */
export interface Returns {
  readonly declared: Type | undefined;
  /** Checks a `return` and what it returns: its value, or `Unit` for a bare one. */
  readonly check: (context: BodyContext, node: Return) => void;
  /** Notes a `?` at `span` that would return an `Err` of `error` (§3.12). */
  readonly propagate: (context: BodyContext, error: Type, span: AnchoredSpan) => void;
}

/** The loops and labelled blocks around what one function checks (closures/enclosing-scopes.ts). */
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

/** The calls the language makes for constructs with no call written (resolution/implicit.ts). */
export interface ImplicitRecord {
  readonly record: (node: NodeOf<string>, role: ImplicitRole, call: ResolvedCall) => void;
  readonly of: (node: NodeOf<string>, role: ImplicitRole) => ResolvedCall | undefined;
}

/** What each collection literal builds (expressions/collections.ts). */
export interface CollectionRecord {
  readonly record: (literal: ArrayLiteral | MapLiteral, form: CollectionForm) => void;
}

/** How each iteration runs (rules/iteration.ts). */
export interface IterationRecord {
  readonly record: (iteration: Iteration, form: IterationForm) => void;
}

/**
 * How each field read reaches its field (expressions/member-access.ts), which a place reaching it
 * asks again: a field a key reads is a place's field, never an element (calls/places.ts).
 */
export interface FieldReadRecord {
  readonly record: (reading: FieldReading, read: FieldRead) => void;
  readonly of: (reading: FieldReading) => FieldRead | undefined;
}

/** Each pattern's tests and bindings (patterns/matching.ts). */
export interface PatternRecord {
  readonly record: (pattern: Pattern, checked: CheckedPattern) => void;
}

/** The links of optional chains (expressions/optionals.ts). */
export interface Chains {
  /**
   * Checks the target of `link`'s step; the type the step works on: the value a chained target
   * carries, the value inside an optional after `?.`, or the error type after a report.
   */
  readonly target: (context: BodyContext, link: Expression) => Type;
  readonly chainOf: (link: Expression) => ChainLink | undefined;
}

/** What each exit and hold names, recorded as statements/loops.ts resolves it. */
export interface LabelRecord extends LabelResolution {
  readonly recordExit: (exit: Break | Continue, target: LabelledScope) => void;
  readonly recordHold: (hold: Hold, target: LabelledScope) => void;
  /** Whether some exit or hold names `scope` by its label. */
  readonly isNamed: (scope: LabelledScope) => boolean;
}
