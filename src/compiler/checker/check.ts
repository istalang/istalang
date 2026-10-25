/**
 * The checker's entry: a program's types (§2–§4), as queries memoized on the Program.
 *
 * Checking is lazy (program-checker.ts): the coordinator asks for every module's diagnostics, and
 * lowering asks for the bodies it lowers, so an editor would pay only for what it asks. The
 * surface below is what later phases read; the context interfaces in context.ts are the checker's
 * own wiring.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { memo } from '../../structures/memo.ts';
import type { Bindings, VariableEntity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { Declaration, FunctionDeclaration, TypeParameter } from '../syntax/declarations.ts';
import type {
  ArrayLiteral,
  Comprehension,
  Expression,
  Lambda,
  MapLiteral,
  Parameter,
  SelectCase,
  Spread,
  StructLiteral,
} from '../syntax/expressions.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
import type { CompareFieldPattern, Pattern } from '../syntax/patterns.ts';
import type { Assignment, For, VariableDeclaration } from '../syntax/statements.ts';
import type { ConstantForm } from './constant-form.ts';
import { ProgramChecker } from './program-checker.ts';
import type { FieldMember, FunctionType, NominalType, Type } from './types/type.ts';
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
 * What a call resolved to (§3.5, §3.7, §3.10). Generics are compiled per instantiation, so a call
 * carries everything its instantiation is made of; types in it may name the calling function's own
 * type parameters, which each of the caller's instantiations substitutes.
 *
 * - `function`: a declared function, with its type arguments, the function each requirement of
 *   its type parameters' constraints calls (`witnesses`), and how many arguments the call gives,
 *   fewer than its parameters when defaults fill the rest (§3.3).
 * - `requirement`: a function a constraint on one of the calling function's own type parameters
 *   requires, such as `add` under `T is Addable`. Which function it is depends on the caller's
 *   instantiation: the `witnesses` of the call that made it.
 */
export type ResolvedCall = FunctionCall | RequirementCall;

/** What every resolved call may carry about how it was written. */
interface WrittenAs {
  /** A method call's receiver (`x` in `x.f()`), passed as the call's first argument (§3.7). */
  readonly receiver?: Expression;
}

export interface FunctionCall extends WrittenAs {
  readonly kind: 'function';
  readonly function: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly arity: number;
}

export interface RequirementCall extends WrittenAs {
  readonly kind: 'requirement';
  /** The trait's function required. */
  readonly function: FunctionDeclaration;
  readonly requirement: RequirementOrigin;
  /** The requirement's own type arguments, when the required function is generic. */
  readonly typeArguments: readonly Type[];
}

/** Which required function: the `member`-th function of the trait of the `constraint`-th constraint on `parameter`. */
export interface RequirementOrigin {
  readonly parameter: TypeParameter;
  readonly constraint: number;
  readonly member: number;
}

/**
 * What binds targets (§3.15): a declaration, a `for` or comprehension for each item, or a select
 * case's `as` for the value of its future (§8).
 */
export type TargetOwner = VariableDeclaration | For | Comprehension | SelectCase;

/** A name a target binds: its part's type, and the positions leading to it (§3.15). */
export interface TargetBinding {
  readonly name: Identifier;
  readonly type: Type;
  /** Field or tuple element positions from the whole value to the part, outermost first. */
  readonly path: readonly number[];
}

/**
 * Where a struct literal's field gets its value (§3.1): an expression of the literal, or the field
 * of that position in its leading spread's value.
 */
export type FieldSource =
  | { readonly kind: 'value'; readonly value: Expression }
  | { readonly kind: 'spread'; readonly from: Expression; readonly index: number }
  | TraceSource;

/**
 * `Error`'s `trace` left out of its literal (§3.12): the call the checker resolved at the literal
 * gives it, writing the frames where the `Error` is built.
 */
export interface TraceSource {
  readonly kind: 'trace';
}

/**
 * One test a value must pass to match a pattern (§3.11), on its part at `path` (field or tuple
 * element positions from the whole value, as for a binding). A pattern's tests run in order, so a
 * variant's fields are read only after its variant was tested.
 *
 * - `variant`: the part is the `variant`-th of its enum's `count` variants.
 * - `equal`: the part `==` a value: a literal or comparison's expression, or a top-level
 *   constant's name; `negated` for `!=`.
 * - `compare`: `compare(part, value)` called at `site`, in the relation its operator names.
 */
export type PatternTest =
  | {
      readonly kind: 'variant';
      readonly path: readonly number[];
      readonly variant: number;
      readonly count: number;
    }
  | {
      readonly kind: 'equal';
      readonly path: readonly number[];
      readonly value: PatternValue;
      readonly negated: boolean;
    }
  | {
      readonly kind: 'compare';
      readonly path: readonly number[];
      readonly site: CompareFieldPattern;
    };

/** What an `equal` test compares with: an expression, or the constant a pattern names. */
export type PatternValue =
  | { readonly kind: 'expression'; readonly node: Expression }
  | { readonly kind: 'constant'; readonly name: Identifier };

/** A `match` case's or `is`'s pattern as checked: its tests, then the names it binds. */
export interface CheckedPattern {
  readonly tests: readonly PatternTest[];
  readonly bindings: readonly TargetBinding[];
}

/**
 * A link of an optional chain (§4): the type its own step works on (the value inside, after
 * `?.`), and whether the chain, if it ends at this link, wraps its value into `T?`, which it
 * doesn't when the value already is optional.
 */
export interface ChainLink {
  readonly base: Type;
  readonly wraps: boolean;
}

/** A place an assignment writes, and the positions of its part in the assigned value (§3.15). */
export interface AssignedPart {
  readonly target: Expression;
  readonly path: readonly number[];
}

/**
 * Per type parameter of a generic callee: for each of its constraints, in order, the call each
 * function of the constraint's trait resolves to, in the trait's order.
 */
export type Witnesses = ReadonlyMap<TypeParameter, readonly (readonly ResolvedCall[])[]>;

/**
 * Nodes a call can be written as: a call, an operator that calls a function (§3.9), `x$`, which
 * calls `unwrap`, indexing, which calls `index`, an assignment, whose compound operator or
 * `x$ = v` calls a function, a pattern's comparison such as `amount > 1000`, which calls `compare`
 * (§3.11), and an `Error` literal that leaves out `trace`, which calls the extern writing it (§3.12).
 * A function named as a value (§3.14), `f`, `ns.f` or `T.f`, is a site too, at the expression
 * naming it, for the function its closure runs.
 */
export type CallSite = NodeOf<
  | 'Call'
  | 'Binary'
  | 'Unary'
  | 'Unwrap'
  | 'Assignment'
  | 'Index'
  | 'CompareFieldPattern'
  | 'StructLiteral'
  | 'Identifier'
  | 'MemberAccess'
>;

/** A construct that runs over an iterable (§3.10): a `for`, a comprehension, or a spread. */
export type Iteration = For | Comprehension | Spread;

/**
 * What a call the language makes for a construct, with no call written, does there (overloads/
 * implicit.ts).
 */
export type ImplicitRole =
  /** `iterate`, which an iteration calls on what it runs over (§3.10). */
  | 'iterate'
  /** The `length` of the array a loop runs over. */
  | 'length'
  /** Reading the array a loop runs over at an index. */
  | 'element'
  /** Comparing a loop's index with the length. */
  | 'compare'
  /** Counting a loop's index up, or `..=` storing its end plus one. */
  | 'add'
  /**
   * Writing a part of a place back: an element with `setIndex` (§3.9), or the value `x$` read,
   * changed, with `rewrap` (§3.8).
   */
  | 'write'
  /** The `default()` a map literal of a type other than `Map` starts from (§2). */
  | 'default'
  /** Assigning an entry of such a map literal with `setIndex`. */
  | 'insert';

/** What a collection literal builds: an `Array`, a `Map`, or a value of another declared type (§2). */
export type CollectionForm = 'array' | 'map' | 'declared';

/** What checking a function body found, for lowering (architecture: phase contracts). */
export interface CheckedBody {
  /** The type of an expression of this body; the error type for one never checked. */
  readonly typeOf: (expression: Expression) => Type;
  /** The function each call site of this body calls, or each function value names. */
  readonly calls: ReadonlyMap<CallSite, ResolvedCall>;
  /**
   * A call the language makes for the construct `node`, in `role`, with no call written for it
   * (overloads/implicit.ts); undefined for a role the construct doesn't need.
   */
  readonly implicitCallOf: (node: NodeOf<string>, role: ImplicitRole) => ResolvedCall | undefined;
  /** What a collection literal builds (§2). */
  readonly collectionFormOf: (literal: ArrayLiteral | MapLiteral) => CollectionForm;
  /** How many times the value of `expression` is wrapped into `Some` where it is used (§2). */
  readonly wrapsOf: (expression: Expression) => number;
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
  /** Who disposes a value of `type` (rules/disposal.ts). */
  readonly disposalOf: (type: NominalType) => Disposal;
  /** `T?` for `type`, the type a value of `type` is wrapped into (§2). */
  readonly optionalOf: (type: Type) => NominalType;
  /** `Shared<T>` for `type`, what a variable passed by `&` lives in (§3.7, §3.14). */
  readonly sharedOf: (type: Type) => NominalType;
}

const checkers = new WeakMap<Program, Checker>();

export function checkProgram(program: Program): Checker {
  return memo(checkers, program, () => new ProgramChecker(program));
}
