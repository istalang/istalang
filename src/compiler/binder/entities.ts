/**
 * What a name denotes, as the binder hands it to the checker: the binder's output vocabulary.
 *
 * - Entities point at the syntax that declares them and carry nothing derived. Their types and
 *   meaning are the checker's, keyed by entity identity. Every entity is made while binding one
 *   tree and lives as long as that tree, so an unchanged module keeps its entities across Program
 *   snapshots, and everything the checker memoized on them.
 * - What depends on the whole program is a query on Bindings, memoized per Program: a function
 *   set's overloads with the prelude's joined, a bare variant's candidates.
 * - Values and types share one namespace per scope. Naming conventions keep them apart (types are
 *   PascalCase, values camelCase), and a type in value position is how `Duration.zero()`,
 *   `float(3)` and `T.zero()` are written.
 * - A local function is a variable whose owner is its declaration: the spec defines it as a `const`
 *   bound to a lambda. Only top-level functions form overload sets.
 * - A bare name that names no declaration may still be an enum variant, which the expected type
 *   chooses (§3.11): it denotes the variants of that name in the program (`candidatesOf`), for the
 *   checker to pick from.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { PrimitiveName } from '../../language/primitives.ts';
import type { ModuleId } from '../program/program.ts';
import type {
  EnumDeclaration,
  ExternConstantDeclaration,
  ExternStructDeclaration,
  FunctionDeclaration,
  NamespaceImport,
  StructDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
  Variant,
} from '../syntax/declarations.ts';
import type { Comprehension, Lambda, Parameter, SelectCase } from '../syntax/expressions.ts';
import type { Identifier } from '../syntax/node.ts';
import type { AsPattern, BindFieldPattern, NamePattern } from '../syntax/patterns.ts';
import type { For, VariableDeclaration } from '../syntax/statements.ts';

/** The node that declares a variable's name; the checker reads its type and mutability there. */
export type VariableOwner =
  | VariableDeclaration
  | ExternConstantDeclaration
  | Parameter
  | For
  | Comprehension
  | SelectCase
  | NamePattern
  | BindFieldPattern
  | AsPattern
  | FunctionDeclaration
  | Lambda;

/** A named value: a variable, constant, parameter, binding, local function or named lambda. */
export interface VariableEntity {
  readonly kind: 'variable';
  readonly name: Identifier;
  readonly owner: VariableOwner;
}

/**
 * A module's top-level functions sharing a name (§3.7); `overloadsOf` adds the prelude's. A called
 * name no scope defines denotes a set with no overloads, which argument-dependent lookup may fill.
 */
export interface FunctionsEntity {
  readonly kind: 'functions';
  readonly name: string;
  readonly overloads: readonly FunctionDeclaration[];
}

export type TypeDeclaration =
  | StructDeclaration
  | ExternStructDeclaration
  | EnumDeclaration
  | TraitDeclaration
  | TypeAliasDeclaration
  | TypeParameter;

export interface TypeEntity {
  readonly kind: 'type';
  readonly declaration: TypeDeclaration;
}

/** A language built-in type (§2). */
export interface PrimitiveEntity {
  readonly kind: 'primitive';
  readonly name: PrimitiveName;
}

/** `Self` inside a trait: the type that satisfies it (§3.10). */
export interface SelfEntity {
  readonly kind: 'self';
  readonly trait: TraitDeclaration;
}

export interface VariantEntity {
  readonly kind: 'variant';
  readonly enum: EnumDeclaration;
  readonly variant: Variant;
}

/** A bare name that may be any variant so named (`candidatesOf`); the expected type decides. */
export interface VariantsEntity {
  readonly kind: 'variants';
  readonly name: string;
}

/** What a name denotes when it names variants: one, qualified, or the candidates of a bare name. */
export type VariantNaming = VariantEntity | VariantsEntity;

/** `m` after `import * as m from 'path'`; the module is the one its import loaded. */
export interface NamespaceEntity {
  readonly kind: 'namespace';
  readonly declaration: NamespaceImport;
}

export type Entity =
  | VariableEntity
  | FunctionsEntity
  | TypeEntity
  | PrimitiveEntity
  | SelfEntity
  | VariantEntity
  | VariantsEntity
  | NamespaceEntity;

/** The names of a whole program, bound. */
export interface Bindings {
  /**
   * What `name` in `module` denotes: a reference's entity, or the entity a declaring name
   * introduces. Undefined when it denotes nothing (a diagnostic says why), and for a member the
   * checker resolves by type, such as `x.field` or `Duration.zero`.
   */
  readonly entityOf: (module: ModuleId, name: Identifier) => Entity | undefined;
  /** The names a module exports: its own top-level declarations not starting with `_`. */
  readonly exportsOf: (module: ModuleId) => ReadonlyMap<string, Entity>;
  /** The module declaring a top-level entity; argument-dependent lookup starts there (§3.13). */
  readonly moduleOf: (entity: Entity) => ModuleId | undefined;
  /** A function set's overloads, the prelude's of the same name joined (§3.13). */
  readonly overloadsOf: (functions: FunctionsEntity) => readonly FunctionDeclaration[];
  /** The variants a bare name may denote; the expected type picks one (§3.11). */
  readonly candidatesOf: (variants: VariantsEntity) => readonly VariantEntity[];
  /**
   * What `name` denotes at the top level of `module`: a declaration or import of its own, or the
   * prelude's. Operators and method calls look up their function's name this way (§3.7, §3.9),
   * since nothing binds it in the tree.
   */
  readonly topLevelNamed: (module: ModuleId, name: string) => Entity | undefined;
  readonly diagnosticsOf: (module: ModuleId) => readonly Diagnostic[];
}
