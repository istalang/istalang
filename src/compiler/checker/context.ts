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
import type { Expression } from '../syntax/expressions/index.ts';
import type { Identifier, Invalid } from '../syntax/node.ts';
import type { Block, Statement } from '../syntax/statements.ts';
import type { TypeNode } from '../syntax/types.ts';
import type { Checker, ValueSite, VariantMember } from './check.ts';
import type { EnclosingScopes } from './closures/enclosing-scopes.ts';
import type { FunctionScopes } from './closures/functions.ts';
import type { OwnCalls } from './closures/own-calls.ts';
import type { ReturnScope } from './closures/returns.ts';
import type { CollectionForms } from './expressions/collections.ts';
import type { StructLiterals } from './expressions/literal-fields.ts';
import type { OptionalChains } from './expressions/optionals.ts';
import type { LabelTargets } from './flow/labels.ts';
import type { JsonCodecs } from './json-form.ts';
import type { CheckedPatterns } from './patterns/matching.ts';
import type { Accepts } from './resolution/choice.ts';
import type { ImplicitCalls } from './resolution/implicit.ts';
import type { CallSite, ResolvedCall } from './resolved-call.ts';
import type { Annotations } from './rules/annotations.ts';
import type { Iterations } from './rules/iteration.ts';
import type { VariableScope } from './statements/variables.ts';
import type { Fit, Fitting, OptionalEntity } from './types/fit.ts';
import type {
  Constraint,
  FieldMember,
  FunctionType,
  NominalDeclaration,
  Substitution,
  Type,
} from './types/type.ts';

/** The program-wide services, beyond what later phases read (check.ts). */
export interface CheckerContext extends Checker {
  readonly report: (module: ModuleId, diagnostic: Diagnostic) => void;
  /** The type `node` denotes in `module`. */
  readonly resolveType: (module: ModuleId, node: TypeNode) => Type;
  /** The type `any` followed by `traits` denotes in `module` (§3.10). */
  readonly anyTypeOf: (module: ModuleId, traits: readonly TypeNode[]) => Type;
  /** A struct declaration's fields, types as declared (not substituted). */
  readonly declaredFieldsOf: (declaration: StructDeclaration) => readonly FieldMember[];
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
  readonly annotations: Annotations;
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
  readonly callAt: (site: CallSite) => ResolvedCall | undefined;
  /** Checks `node` and, when a type is expected, reports when its type doesn't fit it. */
  readonly expect: (node: Expression, expected: Type | undefined) => Type;
  /**
   * Reports at `at` (the site's own span when absent) when `found`, the type of what `site` gives,
   * doesn't fit `expected`. When it fits by converting the value, made async or wrapped into `T?`
   * (§2, §3.14), records the fit for lowering.
   */
  readonly fit: (found: Type, expected: Type, site: ValueSite, at?: Span) => void;
  /**
   * Reports at `at` when `found`, written to a place of `expected` by an assignment, doesn't fit
   * it; how the value is converted to fit (§2, §3.14), which the assignment records on its part.
   */
  readonly fitWritten: (found: Type, expected: Type, at: Span) => Fit;
  /**
   * Reports at `at` when the items of a spread, of `found`, don't fit `expected` as they are: the
   * spread gives its items as a whole, so none of them is wrapped (§2).
   */
  readonly fitUnwrapped: (found: Type, expected: Type, at: Span) => void;
  /** Checks a block in its own scope; its type is that of its last expression (§4). */
  readonly block: (node: Block, expected?: Type) => Type;
  /** Checks a block run only for its effects, such as a loop's body, discarding every value. */
  readonly effectBlock: (node: Block) => void;
  /** Checks a statement; its type, which only a block's last statement passes on (§4). */
  readonly statement: (node: Statement | Invalid, expected?: Type) => Type;
  readonly report: (diagnostic: Diagnostic) => void;
  /** The type `node` denotes in this body's module. */
  readonly resolveType: (node: TypeNode) => Type;
  readonly entityOf: (name: Identifier) => Entity | undefined;
  readonly recordCall: (site: CallSite, call: ResolvedCall) => void;
  /** Whether the innermost function is async, the only kind that may `await` (§5). */
  readonly inAsync: boolean;
  readonly variables: VariableScope;
  readonly literals: StructLiterals;
  /** The functions being checked, the body's own and nested ones (§3.14), innermost current. */
  readonly functions: FunctionScopes;
  /** The innermost function's result. */
  readonly returns: ReturnScope;
  /** The innermost function's loops and labelled blocks. */
  readonly enclosing: EnclosingScopes;
  readonly implicit: ImplicitCalls;
  readonly collections: CollectionForms;
  readonly iterations: Iterations;
  readonly patterns: CheckedPatterns;
  readonly chains: OptionalChains;
  readonly ownCalls: OwnCalls;
  /** What this body's exits and holds name, recorded as it is checked. */
  readonly labels: LabelTargets;
}
