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
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { LanguageModule, ModuleId } from '../program/program.ts';
import type {
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
} from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { CallSite, Checker, FieldMember, ResolvedCall, VariantMember } from './check.ts';
import type { LoopScope } from './statements/loops.ts';
import type { ReturnScope } from './statements/returns.ts';
import type { VariableScope } from './statements/variables.ts';
import type { Type } from './types/type.ts';

/** The program-wide services, beyond what later phases read (check.ts). */
export interface CheckerContext extends Checker {
  readonly report: (module: ModuleId, diagnostic: Diagnostic) => void;
  /** Reports `node` of `module` as a construct not supported yet (named by `construct`); the error type. */
  readonly unsupported: (module: ModuleId, node: NodeOf<string>, construct?: string) => Type;
  /** The type `node` denotes in `module`. */
  readonly resolveType: (module: ModuleId, node: TypeNode) => Type;
  /** A struct declaration's fields, types as declared (not substituted). */
  readonly declaredFieldsOf: (declaration: StructDeclaration) => readonly FieldMember[];
  /** An enum declaration's variants, types as declared (not substituted). */
  readonly declaredVariantsOf: (declaration: EnumDeclaration) => readonly VariantMember[];
  /**
   * A type a language module exports, such as `time`'s `Duration`, with its type arguments;
   * undefined when the program has no such module.
   */
  readonly languageType: (
    module: LanguageModule,
    name: string,
    typeArguments?: readonly Type[],
  ) => Type | undefined;
  /** A prelude type by name, such as `Future`: its `languageType`, or the error type. */
  readonly preludeType: (name: string, typeArguments: readonly Type[]) => Type;
  /** The prelude's functions of `name`, for the operators on primitives (§3.9). */
  readonly preludeFunctions: (name: string) => readonly FunctionDeclaration[];
}

export interface BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  /** Checks `node`, recording its type; `expected` guides inference but isn't enforced. */
  readonly expression: (node: Expression, expected?: Type) => Type;
  /** Checks `node` and reports when its type doesn't fit `expected`. */
  readonly expect: (node: Expression, expected: Type) => Type;
  /** Reports at `at` when `found`, a type already checked, doesn't fit `expected`. */
  readonly fit: (found: Type, expected: Type, at: Span) => void;
  /** Checks a block in its own scope; its type is that of its last expression (§4). */
  readonly block: (node: Block, expected?: Type) => Type;
  /** Checks a statement; its type, which only a block's last statement passes on (§4). */
  readonly statement: (node: Statement | Invalid, expected?: Type) => Type;
  readonly report: (diagnostic: Diagnostic) => void;
  /** Reports `node` as a construct not supported yet (named by `construct`); the error type. */
  readonly unsupported: (node: NodeOf<string>, construct?: string) => Type;
  /** The type `node` denotes in this body's module. */
  readonly resolveType: (node: TypeNode) => Type;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly recordCall: (site: CallSite, call: ResolvedCall) => void;
  /** Whether the body is an async function's, the only kind that may `await` (§5). */
  readonly inAsync: boolean;
  readonly variables: VariableScope;
  readonly returns: ReturnScope;
  readonly loops: LoopScope;
}
