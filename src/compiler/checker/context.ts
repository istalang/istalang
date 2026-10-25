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
import type { PrimitiveName } from '../../language/primitives.ts';
import type { WellKnownDeclaration } from '../../language/well-known.ts';
import type { Span } from '../../text/span.ts';
import type { Entity } from '../binder/entities.ts';
import type { ModuleId } from '../program/program.ts';
import type {
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions.ts';
import type { Identifier, Invalid, NodeOf } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { CallSite, Checker, ResolvedCall, VariantMember } from './check.ts';
import type { CollectionForms } from './expressions/collections.ts';
import type { StructLiterals } from './expressions/literal-fields.ts';
import type { OptionalChains } from './expressions/optionals.ts';
import type { FrontierConstruct } from './frontier.ts';
import type { ImplicitCalls } from './overloads/implicit.ts';
import type { CheckedPatterns } from './patterns/matching.ts';
import type { LoopScope } from './statements/loops.ts';
import type { ReturnScope } from './statements/returns.ts';
import type { VariableScope } from './statements/variables.ts';
import type { Constraint } from './traits/constraints.ts';
import type { OptionalEntity } from './types/fit.ts';
import type { FieldMember, NominalType, Substitution, Type } from './types/type.ts';

/** The program-wide services, beyond what later phases read (check.ts). */
export interface CheckerContext extends Checker {
  readonly report: (module: ModuleId, diagnostic: Diagnostic) => void;
  /** Reports `node` of `module` as a construct not supported yet (named by `construct`); the error type. */
  readonly unsupported: (
    module: ModuleId,
    node: NodeOf<string>,
    construct?: FrontierConstruct,
  ) => Type;
  /** The type `node` denotes in `module`. */
  readonly resolveType: (module: ModuleId, node: TypeNode) => Type;
  /** A struct declaration's fields, types as declared (not substituted). */
  readonly declaredFieldsOf: (declaration: StructDeclaration) => readonly FieldMember[];
  /** An enum declaration's variants, types as declared (not substituted). */
  readonly declaredVariantsOf: (declaration: EnumDeclaration) => readonly VariantMember[];
  /**
   * A well-known type (language/well-known.ts), such as `Future`, with its type arguments;
   * undefined when the program lacks its module.
   */
  readonly wellKnownType: (
    declaration: WellKnownDeclaration,
    typeArguments?: readonly Type[],
  ) => Type | undefined;
  /** The prelude's functions of `name`. */
  readonly preludeFunctions: (name: string) => readonly FunctionDeclaration[];
  /** The prelude's `Optional`, which the implicit wrap fills (§2); undefined without a prelude. */
  readonly optionalEntity: OptionalEntity;
  /** How many wraps into `Some` make `found` fit `expected`; undefined when nothing does (§2). */
  readonly wrapsToFit: (found: Type, expected: Type) => number | undefined;
  /** The constraints after `is` on a type parameter, resolved where it is declared (§3.5). */
  readonly constraintsOf: (parameter: TypeParameter) => readonly Constraint[];
  /** The static functions declared on `owner` in `module` (§3.7). */
  readonly staticFunctionsIn: (
    module: ModuleId,
    owner: StaticOwner,
  ) => readonly FunctionDeclaration[];
  /** The type an alias stands for, its own type parameters left open (§3.17). */
  readonly aliasedType: (alias: TypeAliasDeclaration) => Type;
  /**
   * Notes that the argument `typeArguments` gives `parameter` at `at` in `module` must meet the
   * parameter's constraints (§3.5), which may name the declaration's other parameters. Types resolve while signatures are still being resolved, and meeting a
   * constraint looks at signatures, so the check runs once the module's declarations are checked.
   */
  readonly constrainLater: (
    module: ModuleId,
    at: Span,
    parameter: TypeParameter,
    typeArguments: Substitution,
  ) => void;
}

/** What a static function is declared on: a declared type, or a primitive by name (§3.7). */
export type StaticOwner = NominalType['entity']['declaration'] | PrimitiveName;

export interface BodyContext {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  /** Checks `node`, recording its type; `expected` guides inference but isn't enforced. */
  readonly expression: (node: Expression, expected?: Type) => Type;
  /** The type `node` was checked to have; the error type for a node not checked yet. */
  readonly typeOf: (node: Expression) => Type;
  /** The call recorded at `site`; undefined for one not checked yet or that couldn't be made. */
  readonly callAt: (site: CallSite) => ResolvedCall | undefined;
  /** Checks `node` and, when a type is expected, reports when its type doesn't fit it. */
  readonly expect: (node: Expression, expected: Type | undefined) => Type;
  /**
   * Reports at `at` when `found`, a type already checked, doesn't fit `expected`. When the value is
   * an expression that fits by the implicit wrap into `T?` (§2), records the wrap for lowering.
   */
  readonly fit: (found: Type, expected: Type, at: Expression | Span) => void;
  /** Checks a block in its own scope; its type is that of its last expression (§4). */
  readonly block: (node: Block, expected?: Type) => Type;
  /** Checks a block run only for its effects, such as a loop's body, discarding every value. */
  readonly effectBlock: (node: Block) => void;
  /** Checks a statement; its type, which only a block's last statement passes on (§4). */
  readonly statement: (node: Statement | Invalid, expected?: Type) => Type;
  readonly report: (diagnostic: Diagnostic) => void;
  /** Reports `node` as a construct not supported yet (named by `construct`); the error type. */
  readonly unsupported: (node: NodeOf<string>, construct?: FrontierConstruct) => Type;
  /** The type `node` denotes in this body's module. */
  readonly resolveType: (node: TypeNode) => Type;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly recordCall: (site: CallSite, call: ResolvedCall) => void;
  /** Whether the body is an async function's, the only kind that may `await` (§5). */
  readonly inAsync: boolean;
  readonly variables: VariableScope;
  readonly literals: StructLiterals;
  readonly returns: ReturnScope;
  readonly loops: LoopScope;
  readonly implicit: ImplicitCalls;
  readonly collections: CollectionForms;
  readonly patterns: CheckedPatterns;
  readonly chains: OptionalChains;
}
