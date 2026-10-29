/**
 * The two contexts checking runs in, as interfaces, so the per-construct modules depend on these
 * and never on each other or on the classes that implement them (program-checker.ts,
 * body-checker.ts). This is the same seam the parser's grammar and the binder's local binder use:
 * construct modules recurse through the context, and the wiring lives in one place.
 *
 * - `CheckerContext` answers program-wide questions, each memoized per Program: what later phases
 *   read (check.ts), plus reporting, type nodes' types, and the prelude's types and functions.
 * - `BodyContext` checks one function body: it records every expression's type and every call's
 *   target for lowering (CheckedBody). The facts a body's own rules gather live in per-concern
 *   units beside those rules (variables, returns, loops), so a feature adds a unit, not methods
 *   here.
 *
 * Each unit is declared here as the narrow interface construct modules use, which the class
 * beside its rules implements, so this contract names nothing above the type model and no folder
 * reaches another through it (.dependency-cruiser.mjs).
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { PrimitiveName } from '../../language/primitives.ts';
import type { LanguageModule } from '../../language/well-known.ts';
import type { Entries } from '../../structures/entries.ts';
import type { Entity, VariableEntity, VariantEntity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type {
  Declaration,
  DeclaredStruct,
  EnumDeclaration,
  FunctionDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../syntax/declarations.ts';
import type {
  ArrayLiteral,
  Call,
  Expression,
  FieldsLiteral,
  MapLiteral,
  MemberAccess,
} from '../syntax/expressions/index.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type {
  Assignment,
  Block,
  Break,
  Continue,
  For,
  Hold,
  LabelledScope,
  Return,
  Statement,
  While,
} from '../syntax/statements.ts';
import type { SyntaxTree } from '../syntax/tree.ts';
import type { TypeNode } from '../syntax/types.ts';
import type {
  AssignedPart,
  ChainLink,
  CheckedFunction,
  Checker,
  CollectionForm,
  FieldSource,
  Iteration,
  IterationForm,
  LabelResolution,
  NestedFunction,
  SignatureParameter,
  ValueSite,
  VariantMember,
} from './check.ts';
import type { AnnotationQueries } from './checked-annotation.ts';
import type { FieldRead } from './checked-field.ts';
import type { CheckedPattern, TargetBinding, TargetOwner } from './checked-pattern.ts';
import type { JsonCodecs } from './json-form.ts';
import type { ImplicitRole, ResolvedCall, ResolvedSite } from './resolved-call.ts';
import type { Fit, Fitting, OptionalEntity } from './types/fit.ts';
import type { Substitution } from './types/substitution.ts';
import type {
  Constraint,
  FieldMember,
  FunctionType,
  NominalDeclaration,
  Type,
} from './types/type.ts';

/** That `typeArguments` gives `parameter` an argument at `at`, which must meet its constraints. */
export interface ConstraintCheck {
  readonly at: AnchoredSpan;
  readonly parameter: TypeParameter;
  readonly typeArguments: Substitution;
}

/**
 * What an entry notes while it computes (structures/entries.ts): a diagnostic reported in a
 * module, or a constraint check to run once that module is checked (`constrainLater`).
 */
export type CheckerNote =
  | {
      readonly kind: 'diagnostic';
      readonly module: ModuleId;
      readonly diagnostic: Diagnostic<AnchoredSpan>;
    }
  | { readonly kind: 'constraint'; readonly module: ModuleId; readonly check: ConstraintCheck };

/**
 * What checking reads of its Program, each answer recorded in the entry computing now
 * (program-inputs.ts), so an entry depends only on the parts it read. Checking reads a program
 * through these alone, never through `program`.
 */
export interface ProgramInputs {
  /** `module`'s top-level items, as its tree holds them. */
  readonly itemsOf: (module: ModuleId) => SyntaxTree['root']['items'];
  /** The modules `module`'s imports name. */
  readonly importedBy: (module: ModuleId) => readonly ModuleId[];
  /** The std module the language refers to as `role`; undefined when the program lacks it. */
  readonly role: (role: LanguageModule) => ModuleId | undefined;
  /** `module`'s tree, which tools walk up from a node; checking reads `itemsOf`. */
  readonly treeOf: (module: ModuleId) => SyntaxTree;
  /** The body of `declaration`, a function of `module`, read apart from the rest of its tree. */
  readonly bodyOf: (module: ModuleId, declaration: FunctionDeclaration) => Block | undefined;
  /**
   * The first variant of the program named `name` (§3.11) declared by one of `enums`, in the
   * order the program lists its variants: what a bare name expecting those enums chooses.
   */
  readonly variantNamed: (
    name: string,
    enums: readonly EnumDeclaration[],
  ) => VariantEntity | undefined;
}

/** The program-wide services, beyond what later phases read (check.ts). */
export interface CheckerContext extends Checker {
  /**
   * The tables every program-wide result is kept in, each entry with what it read and reported,
   * so an answer never depends on what was asked before it.
   */
  readonly entries: Entries<CheckerNote>;
  /** What checking reads of its program; `bindings` records its answers alike. */
  readonly inputs: ProgramInputs;
  /**
   * Checks the top-level item `item` of `module` whole, once: what its module's check reads of
   * it, and what a lookup reads before it reads what checking decided inside the item.
   */
  readonly checkItem: (module: ModuleId, item: Declaration) => void;
  /** Reports `diagnostic` in `module`, from the entry computing now. */
  readonly report: (module: ModuleId, diagnostic: Diagnostic<AnchoredSpan>) => void;
  /** How many diagnostics the entry computing now has reported itself, so far. */
  readonly reportCount: () => number;
  /** The type `node` denotes in `module`. */
  readonly resolveType: (module: ModuleId, node: TypeNode) => Type;
  /**
   * The type checking resolved `node` to; undefined for one it never resolved, such as a pattern's
   * or a struct literal's type, which name a type rather than denote one. Asking reports nothing.
   */
  readonly resolvedTypeOf: (node: TypeNode) => Type | undefined;
  /** The type `any` followed by `traits` denotes in `module` (§3.10). */
  readonly anyTypeOf: (module: ModuleId, traits: readonly TypeNode[]) => Type;
  /** A struct declaration's fields, types as declared (not substituted). */
  readonly declaredFieldsOf: (declaration: DeclaredStruct) => readonly FieldMember[];
  /** An enum declaration's variants, types as declared (not substituted). */
  readonly declaredVariantsOf: (declaration: EnumDeclaration) => readonly VariantMember[];
  /** How types cross as JSON, with what meeting `Encodable` and `Decodable` asks (§9). */
  readonly json: JsonCodecs;
  /** The prelude's `Optional`, which the implicit wrap fills (§2); undefined without a prelude. */
  readonly optionalEntity: OptionalEntity;
  /** What fitting a value where a type is expected asks of the program (§2). */
  readonly fitting: Fitting;
  /** How `found` fits `expected`, by implicit conversions; undefined when nothing makes it (§2, §3.14). */
  readonly fitOf: (found: Type, expected: Type) => Fit | undefined;
  /** The constraints after `is` on a type parameter, resolved where it is declared (§3.5). */
  readonly constraintsOf: (parameter: TypeParameter) => readonly Constraint[];
  /** The static functions declared on `owner` in `module` (§3.7). */
  readonly staticFunctionsIn: (
    module: ModuleId,
    owner: StaticOwner,
  ) => readonly FunctionDeclaration[];
  /** Annotations, as later phases read them and as declarations check them (§3.16). */
  readonly annotations: AnnotationChecks;
  /** The type an alias stands for, its own type parameters left open (§3.17). */
  readonly aliasedType: (alias: TypeAliasDeclaration) => Type;
  /**
   * Notes that the argument `typeArguments` gives `parameter` at `at` in `module` must meet the
   * parameter's constraints (§3.5), which may name the declaration's other parameters. Types
   * resolve while signatures are still being resolved, and meeting a constraint looks at
   * signatures, so the check runs once the module's declarations are checked: it is noted in the
   * entry computing now, which that module's check reads.
   */
  readonly constrainLater: (
    module: ModuleId,
    at: AnchoredSpan,
    parameter: TypeParameter,
    typeArguments: Substitution,
  ) => void;
}

/** What a static function is declared on: a declared type, or a primitive by name (§3.7). */
export type StaticOwner = NominalDeclaration | PrimitiveName;

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
 * What one part of a composite argument has before the call is chosen: the parameter types it can
 * take when the call decides its type, or its own type when known without side effects.
 */
export type AcceptedPart =
  | { readonly kind: 'decided'; readonly accepts: Accepts }
  | { readonly kind: 'typed'; readonly type: Type | undefined };

/** What declarations ask of annotations beyond later phases' queries (rules/annotations.ts). */
export interface AnnotationChecks extends AnnotationQueries {
  /** The title `declaration`'s `@Suite` gives its suite (§10); undefined without one. */
  readonly suiteTitleOf: (module: ModuleId, declaration: FunctionDeclaration) => string | undefined;
  /**
   * Checks the annotations of each of `fields`, declared together, and reports each field whose
   * JSON name an earlier one already has.
   */
  readonly checkFields: (fields: readonly FieldMember[]) => void;
}

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
  /** Checks a `return` and what it returns: its value, or `unit` for a bare one. */
  readonly check: (context: BodyContext, node: Return) => void;
  /** Notes a `?` at `span` that would return an `Err` of `error` (§3.12). */
  readonly propagate: (context: BodyContext, error: Type, span: AnchoredSpan) => void;
}

/** The loops and labelled blocks around what one function checks (closures/enclosing-scopes.ts). */
export interface Enclosing {
  /** Runs `check` inside the body of `scope`. */
  readonly inside: <Result>(scope: LabelledScope, check: () => Result) => Result;
  /** The innermost loop around: what a `break` or `continue` with no label leaves. */
  readonly innermostLoop: For | While | undefined;
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

/** How each field read reaches its field (expressions/structs.ts). */
export interface FieldReadRecord {
  readonly record: (access: MemberAccess, read: FieldRead) => void;
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
