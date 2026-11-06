/**
 * The checker's entry: a program's types (§2–§4), as queries memoized on the Program.
 *
 * Checking is lazy (program-checker.ts): the coordinator asks for every module's diagnostics, and
 * lowering asks for the bodies it lowers, so an editor pays only for what it asks, and a checker
 * made after an earlier snapshot's re-checks only what an edit changed. The
 * surface below, with the models in surface/ (a checked body's in checked-body.ts), is what later
 * phases read; the context interfaces in context.ts are the checker's own wiring.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { LanguageModule, WellKnownDeclaration } from '../../language/well-known/index.ts';
import { memo } from '../../structures/memo.ts';
import type { Bindings, Entity } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type {
  AliasDeclaration,
  Declaration,
  FunctionDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../syntax/declarations/index.ts';
import type { Parameter } from '../syntax/expressions/index.ts';
import type { Identifier } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements/index.ts';
import { type CheckerOptions, ProgramChecker } from './program/program-checker.ts';
import type { AnnotationQueries } from './surface/checked-annotation.ts';
import type { CheckedBody } from './surface/checked-body.ts';
import type { ConstantForm } from './surface/constant-form.ts';
import type { LookupQueries } from './surface/denotation.ts';
import type { JsonFormQueries } from './surface/json-form.ts';
import type { FunctionCall, ResolvedCall } from './surface/resolved-call.ts';
import type { Fit } from './types/fitting/fit.ts';
import type { RestSlot } from './types/function-types.ts';
import type { TypeKeys } from './types/identity/type-keys.ts';
import type {
  AnonymousStructType,
  AnyType,
  FieldMember,
  NominalType,
  Type,
} from './types/type/index.ts';
import type { TypeRules } from './types/type-rules.ts';

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
  /**
   * The calls a value of `member` inside the `any` type `type` is called through (§3.10): what
   * meets each function its `constraint`-th constraint's trait requires, in the trait's order.
   */
  readonly memberWitnesses: (
    type: AnyType,
    constraint: number,
    member: Type,
  ) => readonly ResolvedCall[];
  /** `_Cell<T>` for `type`, what a variable passed by `&` or captured lives in (§3.7, §3.14). */
  readonly cellOf: (type: Type) => NominalType;
  /**
   * What a well-known name (language/well-known/index.ts) denotes; undefined without its module.
   */
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
   * The program's rules for building types (types/type-rules.ts), which every substitution and
   * union built after checking, as lowering's, takes, so its types are the checker's.
   */
  readonly typeRules: TypeRules;
  /** The type an alias stands for, its own type parameters left open (§3.17). */
  readonly aliasedType: (alias: AliasDeclaration) => Type;
  /**
   * The arguments `alias` is given where it names `type`; undefined where it names no such type.
   */
  readonly aliasArgumentsFor: (
    alias: TypeAliasDeclaration,
    type: Type,
  ) => readonly Type[] | undefined;
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
