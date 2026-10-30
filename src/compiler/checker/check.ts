/**
 * The checker's entry: a program's types (§2–§4), as queries memoized on the Program.
 *
 * Checking is lazy (program-checker.ts): the coordinator asks for every module's diagnostics, and
 * lowering asks for the bodies it lowers, so an editor pays only for what it asks, and a checker
 * made after an earlier snapshot's re-checks only what an edit changed. The
 * surface below is what later phases read; the context interfaces in context.ts are the checker's
 * own wiring.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { LanguageModule, WellKnownDeclaration } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import type { Bindings, Entity, VariableEntity, VariantEntity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { Declaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type {
  ArrayLiteral,
  Call,
  Comprehension,
  Expression,
  FieldsLiteral,
  Lambda,
  MapLiteral,
  MemberAccess,
  Parameter,
  Spread,
} from '../syntax/expressions/index.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type {
  Assignment,
  Block,
  Break,
  Continue,
  For,
  Hold,
  LabelledScope,
  Return,
  VariableDeclaration,
} from '../syntax/statements.ts';
import type { AnnotationQueries } from './checked-annotation.ts';
import type { FieldRead } from './checked-field.ts';
import type { CheckedPattern, TargetBinding, TargetOwner } from './checked-pattern.ts';
import type { ConstantForm } from './constant-form.ts';
import type { LookupQueries } from './denotation.ts';
import type { JsonFormQueries } from './json-form.ts';
import { type CheckerOptions, ProgramChecker } from './program-checker.ts';
import type {
  FunctionCall,
  ImplicitRole,
  MadeCall,
  ResolvedCall,
  ResolvedSite,
} from './resolved-call.ts';
import type { Fit } from './types/fit.ts';
import type {
  AnonymousStructType,
  AnyType,
  FieldMember,
  FunctionType,
  NominalType,
  RestSlot,
  Type,
} from './types/type.ts';
import type { TypeKeys } from './types/type-keys.ts';

/** A parameter of a declared function, with its resolved type. */
export interface SignatureParameter {
  readonly node: Parameter;
  readonly type: Type;
  readonly reference: boolean;
  /** For a rest parameter, what it collects into: an array of `item` (§3.3), or a pack's tuple (§3.5). */
  readonly rest: RestSlot | undefined;
}

/**
 * A lambda or local function as checked (§3.14): its type, its parameters as checked, in order,
 * a rest one a pack's (§3.5), and what it captures in the order first used. Lowering makes it a
 * function-table entry of its own.
 */
export interface CheckedFunction {
  readonly type: FunctionType;
  readonly parameters: readonly SignatureParameter[];
  readonly captures: readonly CapturedVariable[];
}

/** A function nested in a body: a lambda, or a local `fn` (a `const` bound to one, §3.14). */
export type NestedFunction = Lambda | FunctionDeclaration;

/** A variable a closure captures, with its type. */
export interface CapturedVariable {
  readonly entity: VariableEntity;
  readonly type: Type;
}

/** A variant of an enum type, its fields substituted for the type's arguments. */
export interface VariantMember {
  readonly name: string;
  readonly fields: readonly FieldMember[];
}

/**
 * Where a struct literal's field gets its value (§3.1): an expression of the literal, the field of
 * that position in its leading spread's value, or its default: `call`'s default for that field, of
 * the function the fields read as, computed from the fields before it (syntax/field-defaults.ts).
 */
export type FieldSource =
  | { readonly kind: 'value'; readonly value: Expression }
  | { readonly kind: 'spread'; readonly from: Expression; readonly index: number }
  | { readonly kind: 'default'; readonly call: FunctionCall };

/**
 * A link of an optional chain (§4): the type its own step works on (the value inside, after
 * `?.`), and whether the chain, if it ends at this link, wraps its value into `T?`, which it
 * doesn't when the value already is optional.
 */
export interface ChainLink {
  readonly base: Type;
  readonly wraps: boolean;
}

/**
 * A place an assignment writes, and the part of the assigned value it gets (§3.15): its positions
 * in the value, its type, and how it is converted to fit the place (§2, §3.10, §3.14).
 */
export interface AssignedPart {
  readonly target: Expression;
  readonly path: readonly number[];
  readonly type: Type;
  readonly fit: Fit;
}

/**
 * A node giving a value where one is expected (§2): an expression, the `unit` a bare `return`, or
 * a block with no tail expression, gives, or an array literal's spread, each of whose items fits
 * alike.
 */
export type ValueSite = Expression | Return | Block | Spread;

/** A construct that runs over an iterable (§3.10): a `for`, a comprehension, or a spread. */
export type Iteration = For | Comprehension | Spread;

/** What a collection literal builds: an `Array`, a `Map`, or a value of another declared type (§2). */
export type CollectionForm = 'array' | 'map' | 'declared';

/**
 * How an iteration runs (§3.10): through the cursor its `iterate` call gives, of `item`s, or, for
 * a spread of the collection its literal builds, an array or a `Map`, copied whole.
 */
export type IterationForm =
  | { readonly kind: 'cursor'; readonly item: Type }
  | { readonly kind: 'copied' };

/** What one body's exits and holds name, as lowering and the flow model read it. */
export interface LabelResolution {
  /** The scope `exit` leaves or goes on with; undefined where the checker found none. */
  readonly exitOf: (exit: Break | Continue) => LabelledScope | undefined;
  /** The labelled loop or block what `hold` holds lasts until; undefined for the function. */
  readonly heldUntil: (hold: Hold) => LabelledScope | undefined;
  /** Whether some `hold` names `scope`, which then keeps a list of what it holds. */
  readonly isHoldScope: (scope: LabelledScope) => boolean;
}

/** What checking a function body found, for lowering (architecture: phase contracts). */
export interface CheckedBody {
  /** The type of an expression of this body; undefined for one never checked. */
  readonly typeOf: (expression: Expression) => Type | undefined;
  /**
   * The type expected of the value `site` gives, where its context expects one (§2, §3.11): passed
   * down to its check, or fitted to once checked; undefined where nothing is expected.
   */
  readonly expectedOf: (site: ValueSite) => Type | undefined;
  /** The function each call site of this body calls, or each function value names. */
  readonly resolved: ReadonlyMap<ResolvedSite, ResolvedCall>;
  /** The calls of function values, which call whatever their callee gives (§3.14). */
  readonly valueCalls: ReadonlySet<Call>;
  /**
   * Every call the body makes, where it makes it: its call sites', the language's for constructs
   * with no call written (`implicitCallOf`), and the defaults its struct literals leave fields to.
   */
  readonly madeCalls: () => readonly MadeCall[];
  /**
   * A call the language makes for the construct `node`, in `role`, with no call written for it
   * (resolution/implicit.ts); undefined for a role the construct doesn't need.
   */
  readonly implicitCallOf: (node: NodeOf<string>, role: ImplicitRole) => ResolvedCall | undefined;
  /** What a collection literal builds (§2). */
  readonly collectionFormOf: (literal: ArrayLiteral | MapLiteral) => CollectionForm;
  /** How an iteration runs: through its cursor, or copied whole (§3.10). */
  readonly iterationOf: (iteration: Iteration) => IterationForm;
  /** How the value `site` gives is converted to fit where it is used (§2, §3.10, §3.14). */
  readonly fitAt: (site: ValueSite) => Fit;
  /** What the targets of a declaration, or of a loop for each item, bind: each name's part of the value. */
  readonly targetsOf: (owner: TargetOwner) => readonly TargetBinding[];
  /** Where an assignment's value goes: each place written, with its part of the value. */
  readonly assignedOf: (assignment: Assignment) => readonly AssignedPart[];
  /**
   * Whether the variable `name` declares lives in a cell: passed by `&` anywhere in the body
   * (§3.7), or a `let` a closure captures (§3.14).
   */
  readonly inCell: (name: Identifier) => boolean;
  /** A lambda or local function of this body, as checked. */
  readonly functionOf: (node: Lambda | FunctionDeclaration) => CheckedFunction | undefined;
  /**
   * Where each field of a struct literal gets its value, in declaration order; undefined for a
   * literal the checker found a mistake in.
   */
  readonly sourcesOf: (literal: FieldsLiteral) => readonly FieldSource[] | undefined;
  /**
   * The fields a struct or variant literal builds, typed by the type arguments found for it,
   * whatever its items give: what may be written in it (§3.1); undefined for a literal never
   * checked against declared fields.
   */
  readonly literalFieldsOf: (literal: FieldsLiteral) => readonly FieldMember[] | undefined;
  /** A `match` case's or `is`'s pattern as checked (§3.11); undefined for one never checked. */
  readonly patternOf: (pattern: Pattern) => CheckedPattern | undefined;
  /** A link of an optional chain (§4), such as `a?.b` or the `.c` of `a?.b.c`; else undefined. */
  readonly chainOf: (link: Expression) => ChainLink | undefined;
  /** How the field read `access` reaches its field; undefined where it reads no field. */
  readonly fieldReadOf: (access: MemberAccess) => FieldRead | undefined;
  /**
   * The type of a name the body declares: a variable's, a parameter's, or what a loop, a pattern
   * or a `select` case binds; undefined for any other name.
   */
  readonly declaredTypeOf: (name: Identifier) => Type | undefined;
  /** The field a field's name in a struct literal, a pattern or an assignment's target names. */
  readonly namedFieldOf: (name: Identifier) => FieldMember | undefined;
  /** The variant a bare variant name chose by the type expected of it (§3.11). */
  readonly chosenVariantOf: (name: Identifier) => VariantEntity | undefined;
  /** The functions a call site chose among, in the order considered; none where nothing was. */
  readonly candidatesAt: (site: ResolvedSite) => readonly FunctionDeclaration[];
  /** What each `break`, `continue` and `hold(name)` of the body names (§3.4, §4). */
  readonly labels: LabelResolution;
  /** What the body produces: `T` for an async function returning `Future<T>`. */
  readonly result: Type;
}

/**
 * Who disposes a value of an extern type when its last holder releases it (§7): nobody, the
 * runtime, or the `dispose` declared for it, a call with a handle to the value.
 */
export type Disposal =
  | { readonly kind: 'none' }
  | { readonly kind: 'runtime' }
  | { readonly kind: 'function'; readonly call: FunctionCall };

/** A top-level constant as checked: its type, and its value, unless a diagnostic said why not. */
export interface CheckedConstant {
  readonly type: Type;
  readonly form: ConstantForm | undefined;
}

/** A program's types, as its later phases read them. */
export interface Checker {
  readonly program: Program;
  readonly bindings: Bindings;
  /** Keys for types, and numbers for the identities they are made of, alike in every checker. */
  readonly typeKeys: TypeKeys;
  /** Every diagnostic of checking `module`, which checks all of its declarations. */
  readonly diagnosticsOf: (module: ModuleId) => readonly Diagnostic[];
  /** The module declaring `declaration`: whose item it is, or whose tree holds a local one. */
  readonly moduleOf: (declaration: Declaration | VariableDeclaration) => ModuleId;
  /** Whether the toolchain ships `module` (§3.8); false for none. */
  readonly isStd: (module: ModuleId | undefined) => boolean;
  readonly parametersOf: (declaration: FunctionDeclaration) => readonly SignatureParameter[];
  /** What calling the function yields: `Future<T>` for an async one. */
  readonly resultOf: (declaration: FunctionDeclaration) => Type;
  /** The checked body of a function with one: its expressions' types and its calls' targets. */
  readonly bodyOf: (declaration: FunctionDeclaration) => CheckedBody | undefined;
  /**
   * The checked default values of a function's parameters (§3.3), as one body in which each
   * default sees the parameters before it; undefined for a function with no defaults.
   */
  readonly defaultsOf: (declaration: FunctionDeclaration) => CheckedBody | undefined;
  /** The checked top-level constant `declaration` declares (§3); undefined for any other variable. */
  readonly constantOf: (declaration: VariableDeclaration) => CheckedConstant | undefined;
  /** The checking of a top-level constant's initializer, which lowers its lambdas (§3.14). */
  readonly constantBodyOf: (declaration: VariableDeclaration) => CheckedBody | undefined;
  /** The checked top-level constant `name` denotes in `module`; undefined when it denotes anything else. */
  readonly constantNamed: (module: ModuleId, name: Identifier) => CheckedConstant | undefined;
  /**
   * The fields of a struct type, declared or anonymous, substituted for its type arguments;
   * undefined for another type.
   */
  readonly fieldsOf: (type: Type) => readonly FieldMember[] | undefined;
  /** The variants of an enum type, substituted for its type arguments; undefined for another type. */
  readonly variantsOf: (type: NominalType) => readonly VariantMember[] | undefined;
  /**
   * The value behind a shared struct, `*x` (§3.18), substituted for its type arguments; undefined
   * for another type.
   */
  readonly sharedValueOf: (type: Type) => AnonymousStructType | undefined;
  /** Who disposes a value of `type` (rules/disposal.ts). */
  readonly disposalOf: (type: NominalType) => Disposal;
  /**
   * The calls a value of `member` inside the `any` type `type` is called through (§3.10): what
   * meets each function its `constraint`-th constraint's trait requires, in the trait's order.
   */
  readonly memberWitnesses: (
    type: AnyType,
    constraint: number,
    member: Type,
  ) => readonly ResolvedCall[];
  /** `T?` for `type`, the type a value of `type` is wrapped into (§2). */
  readonly optionalOf: (type: Type) => NominalType;
  /** `_Cell<T>` for `type`, what a variable passed by `&` or captured lives in (§3.7, §3.14). */
  readonly cellOf: (type: Type) => NominalType;
  /** What a well-known name (language/well-known.ts) denotes; undefined without its module. */
  readonly wellKnownEntity: (declaration: WellKnownDeclaration) => Entity | undefined;
  /** The functions of `name` a language module declares, private ones included (§3.13). */
  readonly languageFunctions: (
    module: LanguageModule,
    name: string,
  ) => readonly FunctionDeclaration[];
  /**
   * A well-known type, such as `Future`, with its type arguments; undefined when the program
   * lacks its module.
   */
  readonly wellKnownType: (
    declaration: WellKnownDeclaration,
    typeArguments?: readonly Type[],
  ) => NominalType | undefined;
  /** How types cross as JSON (§9; rules/json-forms/): their codecs, and derived codecs' forms. */
  readonly json: JsonFormQueries;
  /** Annotations, each checked once where its item stands (§3.16; rules/annotations.ts). */
  readonly annotations: AnnotationQueries;
  /** How a value of type `found` fits where `expected` is, by implicit conversions (§2); undefined when it can't. */
  readonly fitOf: (found: Type, expected: Type) => Fit | undefined;
  /** What tools ask by position: what names denote, the body holding a node (lookup/). */
  readonly lookup: LookupQueries;
}

const checkers = new WeakMap<Program, ProgramChecker>();

/** What the checker of a program is made with, the first time it is asked for. */
export interface CheckProgramOptions {
  /**
   * An earlier snapshot, whose checker's entries this one takes over, if that checker was made,
   * wherever what they read answers alike (incremental-checking.md §1).
   */
  readonly previous?: Program | undefined;
  readonly tentative?: CheckerOptions['tentative'];
  readonly observe?: CheckerOptions['observe'];
}

/** The checker of `program`, made once: every checker of one program answers alike. */
export function checkProgram(
  program: Program,
  { previous, tentative, observe }: CheckProgramOptions = {},
): Checker {
  return memo(checkers, program, () => {
    const before = previous === undefined ? undefined : checkers.get(previous);
    return new ProgramChecker(program, { previous: before, tentative, observe });
  });
}
