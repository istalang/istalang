/**
 * What a name denotes, as the binder hands it to the checker: the binder's output vocabulary.
 *
 * - Entities point at the syntax that declares them and carry nothing derived. Their types and
 *   meaning are the checker's, keyed by entity identity. An entity is made once per node it stands
 *   for (a function set once per list of overloads), however often a module is bound, so a segment
 *   an edit left alike keeps its nodes (parser/incremental/reuse.ts) and with them its entities,
 *   and everything the checker took over about them.
 * - What depends on the whole program is a query on Bindings, memoized per Program: a function
 *   set's overloads with the prelude's joined, a bare variant's candidates.
 * - Values and types share one namespace per scope. Naming conventions keep them apart (types are
 *   PascalCase, values camelCase), and a type in value position is how `Duration.zero()`,
 *   `Float(3)` and `T.zero()` are written.
 * - A local function is a variable whose owner is its declaration: the spec defines it as a `const`
 *   bound to a lambda. Only top-level functions form overload sets.
 * - A bare name that names no declaration may still be an enum variant, which the expected type
 *   chooses (§3.11): it denotes the variants of that name in the program (`candidatesOf`), for the
 *   checker to pick from.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { PrimitiveName } from '../../foundation/language/primitives.ts';
import { memo, SequenceMemo } from '../../foundation/structures/memo.ts';
import type { ModuleId } from '../program/program.ts';
import type {
  AssociatedType,
  ContextConstantDeclaration,
  EnumDeclaration,
  ExternConstantDeclaration,
  ExternStructDeclaration,
  FunctionDeclaration,
  NamespaceImport,
  RequiredAssociatedType,
  SharedStructDeclaration,
  StructDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
  Variant,
} from '../syntax/declarations/index.ts';
import type {
  Comprehension,
  FieldHeader,
  Lambda,
  Parameter,
  SelectCase,
} from '../syntax/expressions/index.ts';
import type { AsPattern, BindFieldPattern, NamePattern, RestPattern } from '../syntax/patterns.ts';
import type { For, VariableDeclaration } from '../syntax/statements/index.ts';
import type { Identifier } from '../syntax/tree/node.ts';

/**
 * The call of an async function, which the function's name denotes before a `.` inside it (§7):
 * the owner of a hidden variable that the function's entry fills with its call's handle.
 */
interface OwnCall {
  readonly kind: 'OwnCall';
  readonly function: FunctionDeclaration | Lambda;
}

/**
 * What declares a variable's name, where the checker reads its type and mutability: a node, or an
 * async function's own call.
 */
export type VariableOwner =
  | OwnCall
  | VariableDeclaration
  | ExternConstantDeclaration
  | ContextConstantDeclaration
  | Parameter
  | For
  | FieldHeader
  | Comprehension
  | SelectCase
  | NamePattern
  | BindFieldPattern
  | AsPattern
  | RestPattern
  | FunctionDeclaration
  | Lambda;

/** A named value: a variable, constant, parameter, binding, local function or named lambda. */
export interface VariableEntity {
  readonly kind: 'variable';
  readonly name: Identifier;
  readonly owner: VariableOwner;
}

/**
 * The local `fn` or named lambda whose own name `variable` is; undefined for any other variable.
 */
export function localFunctionOf(
  variable: VariableEntity,
): FunctionDeclaration | Lambda | undefined {
  const { owner } = variable;
  return owner.kind === 'FunctionDeclaration' || owner.kind === 'Lambda' ? owner : undefined;
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

type TypeDeclaration =
  | AssociatedType
  | RequiredAssociatedType
  | StructDeclaration
  | SharedStructDeclaration
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

/** What names may follow and a dot: a module's namespace, or an enum's variants. */
export type Qualifier = NamespaceEntity | (TypeEntity & { readonly declaration: EnumDeclaration });

/**
 * Whether `entity` is a qualifier itself; an alias may stand for one (binder/link/qualifiers.ts).
 */
export function qualifies(entity: Entity): entity is Qualifier {
  return (
    entity.kind === 'namespace' ||
    (entity.kind === 'type' && entity.declaration.kind === 'EnumDeclaration')
  );
}

/** Whether `entity` is an alias, which may stand for a qualifier once linked (§3.17). */
export function isAlias(entity: Entity): boolean {
  return entity.kind === 'type' && entity.declaration.kind === 'TypeAliasDeclaration';
}

/** Whether `entity` is a type, as a name written in a type must be. */
export function namesType(entity: Entity): entity is TypeEntity | PrimitiveEntity | SelfEntity {
  return entity.kind === 'type' || entity.kind === 'primitive' || entity.kind === 'self';
}

/** One name in a module that denotes an entity. */
const variables = new WeakMap<Identifier, VariableEntity>();
const ownCalls = new WeakMap<FunctionDeclaration | Lambda, VariableEntity>();
const types = new WeakMap<TypeDeclaration, TypeEntity>();
const selves = new WeakMap<TraitDeclaration, SelfEntity>();
const variants = new WeakMap<Variant, VariantEntity>();
const namespaces = new WeakMap<NamespaceImport, NamespaceEntity>();
const functionSets = new SequenceMemo<FunctionDeclaration, FunctionsEntity>();

/** The variable `name` declares, `owner` declaring it. */
export function variableEntity(name: Identifier, owner: VariableOwner): VariableEntity {
  return memo(variables, name, () => ({ kind: 'variable', name, owner }));
}

/**
 * The variable an async function holds its own call in, named like the function where it declares
 * its name, so a name before a `.` in its body reads it (§7).
 */
export function ownCallEntity(
  node: FunctionDeclaration | Lambda,
  declared: Identifier,
): VariableEntity {
  return memo(ownCalls, node, () => {
    const name: Identifier = { kind: 'Identifier', span: declared.span, text: declared.text };
    return { kind: 'variable', name, owner: { kind: 'OwnCall', function: node } };
  });
}

export function typeEntity(declaration: TypeDeclaration): TypeEntity {
  return memo(types, declaration, () => ({ kind: 'type', declaration }));
}

/** `Self` in `trait`. */
export function selfEntity(trait: TraitDeclaration): SelfEntity {
  return memo(selves, trait, () => ({ kind: 'self', trait }));
}

export function variantEntity(declaration: EnumDeclaration, variant: Variant): VariantEntity {
  return memo(variants, variant, () => ({ kind: 'variant', enum: declaration, variant }));
}

export function namespaceEntity(declaration: NamespaceImport): NamespaceEntity {
  return memo(namespaces, declaration, () => ({ kind: 'namespace', declaration }));
}

/** The top-level functions `overloads`, all named `name`, as one set. */
export function functionsEntity(
  name: string,
  overloads: readonly FunctionDeclaration[],
): FunctionsEntity {
  return functionSets.get(overloads, () => ({ kind: 'functions', name, overloads }));
}

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
  /**
   * The module declaring `entity`, at its top level or inside a declaration; argument-dependent
   * lookup starts there (§3.13). Undefined for what no module declares: a primitive type, or the
   * candidates of a bare variant.
   */
  readonly moduleOf: (entity: Entity) => ModuleId | undefined;
  /** Whether `entity` is one of its module's top-level names rather than declared inside one. */
  readonly isTopLevel: (entity: Entity) => boolean;
  /**
   * The names visible at `offset` in `module`, each with what it denotes there: its scopes'
   * (§3.4), its top level's and imports', then the prelude's exports, then, for any other name an
   * enum of the program has a variant by, those variants, in the order a free name resolves.
   */
  readonly visibleAt: (module: ModuleId, offset: number) => ReadonlyMap<string, Entity>;
  /** A function set's overloads, the prelude's of the same name joined (§3.13). */
  readonly overloadsOf: (functions: FunctionsEntity) => readonly FunctionDeclaration[];
  /** The variants a bare name may denote; the expected type picks one (§3.11). */
  readonly candidatesOf: (variants: VariantsEntity) => readonly VariantEntity[];
  /**
   * The variable the async function `node` of `module` holds its own call in (§7); undefined
   * unless its name before a `.` reads it.
   */
  readonly ownCallOf: (
    module: ModuleId,
    node: FunctionDeclaration | Lambda,
  ) => VariableEntity | undefined;
  /**
   * What `name` denotes at the top level of `module`: a declaration or import of its own, or the
   * prelude's. Operators and method calls look up their function's name this way (§3.7, §3.9),
   * since nothing binds it in the tree.
   */
  readonly topLevelNamed: (module: ModuleId, name: string) => Entity | undefined;
  /**
   * The alias of the renaming import (§3.13) through which `name` of `module` denotes its entity:
   * for the alias and each of its uses; undefined for any other name, the export's own name in the
   * import among them. The alias declares a name of its own, which tools rename apart from the
   * export.
   */
  readonly aliasOf: (module: ModuleId, name: Identifier) => Identifier | undefined;
  readonly diagnosticsOf: (module: ModuleId) => readonly Diagnostic[];
}
