/**
 * The checker's entry: a program's types (§2–§4), as queries memoized on the Program.
 *
 * Checking is lazy (program-checker.ts): the coordinator asks for every module's diagnostics, and
 * lowering asks for the bodies it lowers, so an editor would pay only for what it asks. The
 * surface below is what later phases read; the context interfaces in context.ts are the checker's
 * own wiring.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Bindings } from '../binder/entities.ts';
import type { ModuleId, Program } from '../program/program.ts';
import type { Declaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type { Expression, Parameter } from '../syntax/expressions.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
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

/** The function a call resolved to, with the type arguments of its instantiation (§3.5). */
export interface ResolvedCall {
  readonly function: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
}

/**
 * Nodes a call can be written as: a call, an operator that calls a function (§3.9), or a compound
 * assignment, which calls its operator's function.
 */
export type CallSite = NodeOf<'Call' | 'Binary' | 'Unary' | 'Assignment'>;

/** What checking a function body found, for lowering (architecture: phase contracts). */
export interface CheckedBody {
  /** The type of an expression of this body; the error type for one never checked. */
  readonly typeOf: (expression: Expression) => Type;
  /** The function a call site of this body calls; undefined where nothing is called. */
  readonly callOf: (site: CallSite) => ResolvedCall | undefined;
  /** What the body produces: `T` for an async function returning `Future<T>`. */
  readonly result: Type;
}

/** Who disposes a value of an extern type when its last holder releases it (§7). */
export type Disposal = 'none' | 'runtime';

/** A top-level constant as checked: its initializer's types, its type as `result`, and its module. */
export interface CheckedConstant extends CheckedBody {
  readonly module: ModuleId;
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
   * A top-level constant's checked initializer, its `result` the constant's type (§3); undefined
   * for any other variable.
   */
  readonly constantOf: (declaration: VariableDeclaration) => CheckedConstant | undefined;
  /** The fields of a struct type, substituted for its type arguments; undefined for another type. */
  readonly fieldsOf: (type: NominalType) => readonly FieldMember[] | undefined;
  /** The variants of an enum type, substituted for its type arguments; undefined for another type. */
  readonly variantsOf: (type: NominalType) => readonly VariantMember[] | undefined;
  /** Who disposes a value of `type` (rules/disposal.ts). */
  readonly disposalOf: (type: NominalType) => Disposal;
}

const checkers = new WeakMap<Program, Checker>();

export function checkProgram(program: Program): Checker {
  let checker = checkers.get(program);
  if (checker === undefined) {
    checker = new ProgramChecker(program);
    checkers.set(program, checker);
  }
  return checker;
}
