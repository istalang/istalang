/**
 * The checker's entry: a program's types (§2–§4), as queries memoized on the Program.
 *
 * Checking is lazy (program-checker.ts): the coordinator asks for every module's diagnostics, and
 * lowering asks for the bodies it lowers, so an editor pays only for what it asks, and a checker
 * made after an earlier snapshot's re-checks only what an edit changed. The
 * surface below, with the models in surface/ (a checked body's in checked-body.ts), is what later
 * phases read; the context interfaces in contexts/context.ts are the checker's own wiring.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type {
  LanguageModule,
  WellKnownDeclaration,
} from '../../foundation/language/well-known/index.ts';
import { memo } from '../../foundation/structures/memo.ts';
import type { Span } from '../../foundation/text/span.ts';
import type { Bindings, Entity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type {
  AliasDeclaration,
  ContextConstantDeclaration,
  Declaration,
  FunctionDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../syntax/declarations/index.ts';
import type { Parameter } from '../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../syntax/statements/index.ts';
import type { Identifier } from '../syntax/tree/node.ts';
import type { FieldDeclaration } from '../syntax/types/index.ts';
import type { AnnotationQueries } from './surface/checked-annotation.ts';
import type { CheckedBody } from './surface/checked-body.ts';
import type { ConstantForm } from './surface/constant-form.ts';
import type { LookupQueries } from './surface/denotation.ts';
import type { JsonFormQueries } from './surface/json-form.ts';
import type { FunctionCall, ResolvedCall } from './surface/resolved-call.ts';
import type { Fit, Fitting } from './types/fitting/fit/index.ts';
import type { TypeKeys } from './types/identity/type-keys.ts';
import type { Substitution } from './types/parts/substitution.ts';
import type { RestSlot } from './types/type/function-types.ts';
import type {
  AnonymousStructType,
  AnyType,
  FieldMember,
  FunctionType,
  NominalType,
  Type,
} from './types/type/index.ts';
import type { TypeRules } from './types/type/type-rules.ts';
import { type CheckerOptions, ProgramChecker } from './wiring/program/program-checker.ts';

/** A variant of an enum type, its fields substituted for the type's arguments. */
export interface VariantMember {
  readonly name: string;
  readonly fields: readonly FieldMember[];
}

/**
 * Who disposes a value of an extern type when its last holder releases it (§7): nobody, the
 * runtime, or the `dispose` declared for it, a call with a handle to the value.
 */
export type Disposal =
  | { readonly kind: 'none' }
  | { readonly kind: 'runtime' | 'function'; readonly call: FunctionCall };

/**
 * What one parameter of an extern function comes to hold (§3.16): the values of the parameters at
 * `kept`, by position, as the parameter at `holder` does.
 */
export interface Kept {
  readonly holder: number;
  readonly kept: readonly number[];
}

/** A top-level constant as checked: its type, and its value, unless a diagnostic said why not. */
export interface CheckedConstant {
  readonly type: Type;
  readonly form: ConstantForm | undefined;
}

/** What checking context constants gives (§3.4). */
export interface ContextConstantQueries {
  /** The type of `declaration`: its written one, or its initializer's. */
  readonly typeOf: (declaration: ContextConstantDeclaration) => Type;
  /** The checking of its initializer, a value within it, which lowers into its own entry. */
  readonly bodyOf: (declaration: ContextConstantDeclaration) => CheckedBody;
}

/** A program's types, as its later phases read them. */
export interface Checker {
  readonly program: Program;
  readonly bindings: Bindings;
  /** Keys for types, and numbers for the identities they are made of, alike in every checker. */
  readonly typeKeys: TypeKeys;
  /** Every diagnostic of checking `module`, which checks all of its declarations. */
  readonly diagnosticsOf: (module: ModuleId) => readonly Diagnostic<Span, ModuleId>[];
  /** The module declaring `declaration`: whose item it is, or whose tree holds a local one. */
  readonly moduleOf: (declaration: Declaration | VariableDeclaration | TypeParameter) => ModuleId;
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
  /**
   * The checked top-level constant `declaration` declares (§3); undefined for any other variable.
   */
  readonly constantOf: (declaration: VariableDeclaration) => CheckedConstant | undefined;
  /** The checking of a top-level constant's initializer, which lowers its lambdas (§3.14). */
  readonly constantBodyOf: (declaration: VariableDeclaration) => CheckedBody | undefined;
  /** The context constants' types and initializers, checked (§3.4). */
  readonly contextConstants: ContextConstantQueries;
  /**
   * The checked top-level constant `name` denotes in `module`; undefined when it denotes anything
   * else.
   */
  readonly constantNamed: (module: ModuleId, name: Identifier) => CheckedConstant | undefined;
  /**
   * The fields of a struct type, declared or anonymous, substituted for its type arguments;
   * undefined for another type.
   */
  readonly fieldsOf: (type: Type) => readonly FieldMember[] | undefined;
  /**
   * The variants of an enum type, substituted for its type arguments; undefined for another type.
   */
  readonly variantsOf: (type: NominalType) => readonly VariantMember[] | undefined;
  /**
   * The value behind a shared struct, `*x` (§3.18), substituted for its type arguments; undefined
   * for another type.
   */
  readonly sharedValueOf: (type: Type) => AnonymousStructType | undefined;
  /** Who disposes a value of `type` (rules/disposal/disposal.ts). */
  readonly disposalOf: (type: NominalType) => Disposal;
  /** The kinds of the `dispose` functions that may take `type` (rules/disposal/disposal.ts). */
  readonly disposeKindsOf: (type: NominalType) => readonly Type[];
  /**
   * What a value of an extern type holds one level down, as its `@Holds` says, else its type
   * arguments (rules/lifetimes/externs.ts).
   */
  readonly externHeldOf: (type: NominalType) => readonly Type[];
  /**
   * What the parameters of an extern function come to hold, as its `@Keeps` says, else through `&`
   * (rules/lifetimes/externs.ts).
   */
  readonly keepsOf: (declaration: FunctionDeclaration) => readonly Kept[];
  /** How values of `any` types are called, read and taken apart (§3.10). */
  readonly traitObjects: TraitObjects;
  /** `_Cell<T>` for `type`, what a variable passed by `&` or captured lives in (§3.7, §3.14). */
  readonly cellOf: (type: Type) => NominalType;
  /**
   * What a well-known name (foundation/language/well-known/index.ts) denotes; undefined without its
   * module.
   */
  readonly wellKnownEntity: (declaration: WellKnownDeclaration) => Entity | undefined;
  /** The functions of `name` a language module declares, private ones included (§3.13). */
  readonly languageFunctions: (
    module: LanguageModule,
    name: string,
  ) => readonly FunctionDeclaration[];
  /** The functions of `name` `module` declares at its top level, private ones included (§3.13). */
  readonly topLevelFunctions: (module: ModuleId, name: string) => readonly FunctionDeclaration[];
  /**
   * A well-known type, such as `Future`, with its type arguments; undefined when the program
   * lacks its module.
   */
  readonly wellKnownType: (
    declaration: WellKnownDeclaration,
    typeArguments?: readonly Type[],
  ) => NominalType | undefined;
  /**
   * How types cross as JSON (§9; rules/boundary/json-forms.ts): their codecs, and derived codecs'
   * forms.
   */
  readonly json: JsonFormQueries;
  /** Annotations, each checked once where its item stands (§3.16; rules/annotations.ts). */
  readonly annotations: AnnotationQueries;
  /**
   * How a value of type `found` fits where `expected` is, by implicit conversions (§2); undefined
   * when it can't.
   */
  readonly fitOf: (found: Type, expected: Type) => Fit | undefined;
  /**
   * What fitting decides that lowering reads: what a type parameter qualifies functions by, and the
   * union a member-bounded type stands for one member of.
   */
  readonly fitting: Pick<Fitting, 'qualifierOf' | 'memberUnionOf'>;
  /**
   * The program's rules for building types (types/type/type-rules.ts), which every substitution and
   * union built after checking, as lowering's, takes, so its types are the checker's.
   */
  readonly typeRules: TypeRules;
  /** The type an alias stands for, its own type parameters left open (§3.17). */
  readonly aliasedType: (alias: AliasDeclaration) => Type;
  /** The kind of a function's code (§3.3; types/type/function-kinds.ts). */
  readonly kindOf: (declaration: FunctionDeclaration) => Type;
  /**
   * The arguments `alias` is given where it names `type`; undefined where it names no such type.
   */
  readonly aliasArgumentsFor: (
    alias: TypeAliasDeclaration,
    type: Type,
  ) => readonly Type[] | undefined;
  /**
   * Whether values of `type` may reach a disposable (rules/lifetimes/): what the runtime counts
   * (design.md §9.1).
   */
  readonly reachesDisposable: (type: Type) => boolean;
  /** What tools ask by position: what names denote, the body holding a node (lookup/). */
  readonly lookup: LookupQueries;
}

const checkers = new WeakMap<Program, ProgramChecker>();

/** What the checker of a program is made with, the first time it is asked for. */
interface CheckProgramOptions {
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

/**
 * How values of `any` types are called, read and taken apart (§3.10): through the functions each
 * value's own type meets a trait with, at the instantiation it meets in the `any` type's
 * constraint's place, which the trait's variance may let differ, what is taken and given then
 * converting between the two (resolution/conformance/met-instantiations/index.ts).
 */
export interface TraitObjects {
  /**
   * The calls a value of `member` inside `type` is called through for its `constraint`-th
   * constraint: what meets each function its trait requires, in the trait's order; undefined
   * where `member` doesn't meet it, a mistake checking reports where the value goes in.
   */
  readonly memberWitnesses: (
    type: AnyType,
    constraint: number,
    member: Type,
  ) => readonly ResolvedCall[] | undefined;
  /**
   * A call of `required`, with its own `typeArguments`, through `type`'s `constraint`-th constraint
   * on a value of `member`: the function type it is made at (`called`), and the one `member`'s
   * function has (`met`); undefined where `member` meets the constraint itself.
   */
  readonly memberSignatures: (
    type: AnyType,
    constraint: number,
    member: Type,
    call: { readonly required: FunctionDeclaration; readonly typeArguments: readonly Type[] },
  ) => MemberConversion<FunctionType> | undefined;
  /**
   * How a call of `required`, with its own `typeArguments`, through `type`'s `constraint`-th
   * constraint on a value of `on` maps the required function's types: the trait's parameters as
   * the constraint gives them, `Self` as `on`, and its own as the call gives them.
   */
  readonly callSubstitution: (
    type: AnyType,
    constraint: number,
    on: Type,
    call: { readonly required: FunctionDeclaration; readonly typeArguments: readonly Type[] },
  ) => Substitution;
  /**
   * A read of `field`, which `type`'s `constraint`-th constraint requires, on a value of `member`:
   * the type it is read at, and the one `member` holds; undefined where they are the same.
   */
  readonly memberFieldTypes: (
    type: AnyType,
    constraint: number,
    member: Type,
    field: FieldDeclaration,
  ) => MemberConversion<Type> | undefined;
  /**
   * Whether a value of `type` may be inside `target`: it converts into it, or meets its traits at
   * instantiations none closer, as a value another `any` type took may.
   */
  readonly mayHold: (type: Type, target: AnyType) => boolean;
}

/** What a call or read through an `any` type is made at (`called`), and what it reaches (`met`). */
export interface MemberConversion<Shape> {
  readonly called: Shape;
  readonly met: Shape;
}

/** A parameter of a declared function, with its resolved type. */
export interface SignatureParameter {
  readonly node: Parameter;
  readonly type: Type;
  readonly reference: boolean;
  /**
   * For a rest parameter, what it collects into: an array of `item` (§3.3), or a pack's tuple
   * (§3.5).
   */
  readonly rest: RestSlot | undefined;
}
