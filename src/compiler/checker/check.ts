/**
 * The checker's entry: a program's types (§2–§4), as queries memoized on the Program.
 *
 * Checking is lazy (program-checker.ts): the coordinator asks for every module's diagnostics, and
 * lowering asks for the bodies it lowers, so an editor would pay only for what it asks. The
 * surface below is what later phases read; the context interfaces in context.ts are the checker's
 * own wiring.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { LanguageModule, WellKnownDeclaration } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import type { Bindings, Entity, VariableEntity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { Declaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type {
  ArrayLiteral,
  Comprehension,
  Expression,
  Lambda,
  MapLiteral,
  Parameter,
  Spread,
  StructLiteral,
} from '../syntax/expressions/index.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
import type { Pattern } from '../syntax/patterns.ts';
import type { Assignment, Block, For, Return, VariableDeclaration } from '../syntax/statements.ts';
import type { AnnotationQueries } from './checked-annotation.ts';
import type { CheckedPattern, TargetBinding, TargetOwner } from './checked-pattern.ts';
import type { ConstantForm } from './constant-form.ts';
import type { LabelResolution } from './flow/labels.ts';
import type { JsonFormQueries } from './json-form.ts';
import { ProgramChecker } from './program-checker.ts';
import type {
  CallSite,
  FunctionCall,
  ImplicitRole,
  MadeCall,
  ResolvedCall,
} from './resolved-call.ts';
import type { Fit } from './types/fit.ts';
import type {
  AnonymousStructType,
  AnyType,
  FieldMember,
  FunctionType,
  NominalType,
  Type,
} from './types/type.ts';
import type { TypeKeys } from './types/type-keys.ts';

/** A parameter of a declared function, with its resolved type. */
export interface SignatureParameter {
  readonly node: Parameter;
  readonly type: Type;
  readonly reference: boolean;
}

/**
 * A lambda or local function as checked (§3.14): its type, the parameters its slots are declared
 * as, in order, and what it captures in the order first used. Lowering makes it a function-table
 * entry of its own.
 */
export interface CheckedFunction {
  readonly type: FunctionType;
  readonly parameters: readonly Parameter[];
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
 * A node giving a value where one is expected (§2): an expression, or the `unit` a bare `return`,
 * or a block with no tail expression, gives.
 */
export type ValueSite = Expression | Return | Block;

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

/** What checking a function body found, for lowering (architecture: phase contracts). */
export interface CheckedBody {
  /** The type of an expression of this body; the error type for one never checked. */
  readonly typeOf: (expression: Expression) => Type;
  /** The function each call site of this body calls, or each function value names. */
  readonly calls: ReadonlyMap<CallSite, ResolvedCall>;
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
  readonly sourcesOf: (literal: StructLiteral) => readonly FieldSource[] | undefined;
  /** A `match` case's or `is`'s pattern as checked (§3.11). */
  readonly patternOf: (pattern: Pattern) => CheckedPattern;
  /** A link of an optional chain (§4), such as `a?.b` or the `.c` of `a?.b.c`; else undefined. */
  readonly chainOf: (link: Expression) => ChainLink | undefined;
  /**
   * The hidden variable holding the handle of the call an async function's own name reads where
   * it stands before a `.` (§7), such as `worker` in `worker.disposing()`; undefined for any other
   * expression.
   */
  readonly ownCallReadAt: (name: Expression) => VariableEntity | undefined;
  /**
   * The hidden variable `owner`, a function of this body, takes its own call's handle into at its
   * entry, when its name reads that call (§7).
   */
  readonly ownCallOf: (owner: NestedFunction) => VariableEntity | undefined;
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
  /** Keys for types, and numbers for the identities they are made of, for this program. */
  readonly typeKeys: TypeKeys;
  /** Every diagnostic of checking `module`, which checks all of its declarations. */
  readonly diagnosticsOf: (module: ModuleId) => readonly Diagnostic[];
  /** The module whose item `declaration` is, a top-level constant's among them. */
  readonly moduleOf: (declaration: Declaration | VariableDeclaration) => ModuleId;
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
}

const checkers = new WeakMap<Program, Checker>();

export function checkProgram(program: Program): Checker {
  return memo(checkers, program, () => new ProgramChecker(program));
}
