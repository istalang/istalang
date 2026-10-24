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
import type { Bindings } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { Declaration, FunctionDeclaration, TypeParameter } from '../syntax/declarations.ts';
import type { Expression, Parameter } from '../syntax/expressions.ts';
import type { Identifier, NodeOf } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import type { ConstantForm } from './constant-form.ts';
import { ProgramChecker } from './program-checker.ts';
import type { NominalType, Type } from './types/type.ts';

/** A parameter of a declared function, with its resolved type. */
export interface SignatureParameter {
  readonly node: Parameter;
  readonly type: Type;
  readonly reference: boolean;
}

/** A struct field of a nominal type, its type substituted for the type's arguments. */
export interface FieldMember {
  readonly name: string;
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

export interface FunctionCall {
  readonly kind: 'function';
  readonly function: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly arity: number;
}

export interface RequirementCall {
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
 * Per type parameter of a generic callee: for each of its constraints, in order, the call each
 * function of the constraint's trait resolves to, in the trait's order.
 */
export type Witnesses = ReadonlyMap<TypeParameter, readonly (readonly ResolvedCall[])[]>;

/**
 * Nodes a call can be written as: a call, an operator that calls a function (§3.9), `x$`, which
 * calls `unwrap`, or an assignment, whose compound operator or `x$ = v` calls a function.
 */
export type CallSite = NodeOf<'Call' | 'Binary' | 'Unary' | 'Unwrap' | 'Assignment'>;

/** What checking a function body found, for lowering (architecture: phase contracts). */
export interface CheckedBody {
  /** The type of an expression of this body; the error type for one never checked. */
  readonly typeOf: (expression: Expression) => Type;
  /** The function each call site of this body calls. */
  readonly calls: ReadonlyMap<CallSite, ResolvedCall>;
  /** How many times the value of `expression` is wrapped into `Some` where it is used (§2). */
  readonly wrapsOf: (expression: Expression) => number;
  /** What the body produces: `T` for an async function returning `Future<T>`. */
  readonly result: Type;
}

/** Who disposes a value of an extern type when its last holder releases it (§7). */
export type Disposal = 'none' | 'runtime';

/** A top-level constant as checked: its type, and its value, unless a diagnostic said why not. */
export interface CheckedConstant {
  readonly type: Type;
  readonly form: ConstantForm | undefined;
}

/** A program's types, as its later phases read them. */
export interface Checker {
  readonly program: Program;
  readonly bindings: Bindings;
  /** Every diagnostic of checking `module`, which checks all of its declarations. */
  readonly diagnosticsOf: (module: ModuleId) => readonly Diagnostic[];
  readonly moduleOf: (declaration: Declaration) => ModuleId;
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
  /** The checked top-level constant `name` denotes in `module`; undefined when it denotes anything else. */
  readonly constantNamed: (module: ModuleId, name: Identifier) => CheckedConstant | undefined;
  /** The fields of a struct type, substituted for its type arguments; undefined for another type. */
  readonly fieldsOf: (type: NominalType) => readonly FieldMember[] | undefined;
  /** The variants of an enum type, substituted for its type arguments; undefined for another type. */
  readonly variantsOf: (type: NominalType) => readonly VariantMember[] | undefined;
  /** Who disposes a value of `type` (rules/disposal.ts). */
  readonly disposalOf: (type: NominalType) => Disposal;
  /** `T?` for `type`, the type a value of `type` is wrapped into (§2). */
  readonly optionalOf: (type: Type) => NominalType;
}

const checkers = new WeakMap<Program, Checker>();

export function checkProgram(program: Program): Checker {
  return memo(checkers, program, () => new ProgramChecker(program));
}
