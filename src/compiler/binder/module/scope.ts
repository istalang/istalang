/**
 * Lexical scopes while one module is bound (§3.4): what each scope defines so far, and why a name
 * may be missing from it.
 *
 * Scopes nest from the universe (the primitive types) through the module to functions, blocks and
 * bindings. A block defines its names one statement at a time, so nothing is hoisted, while the
 * module defines every top-level name before anything is bound, so declarations come in any order.
 *
 * A lookup that finds nothing may still have an explanation, kept here instead of being searched
 * for afterwards:
 * - `pending`: a later statement of an enclosing block declares the name (used before declaration)
 * - `ended`: a nested block that has ended declared it
 * - `underOr`: one side of an `or` bound it, so it isn't known to have matched (§3.11)
 * - `fenced`: it is a variable of the function a transient's initializer stands in (§3.4)
 *
 * A fenced scope, a transient's initializer's, sees past itself the types of the functions around
 * it but none of their variables: the initializer runs at the outermost call alone, so a name its
 * function's variable would hide means what the module gives it.
 *
 * During local binding, a named import is a placeholder: which entity it names is known only once
 * the program is linked.
 *
 * A function's scope knows its function, so a name before a `.` can find the enclosing function it
 * names, whose call it denotes (§7).
 *
 * Scopes outlive binding, for tools that ask what is visible where (visibility.ts). Every
 * definition in one tree's scopes is numbered in the order binding made it, so a snapshot (a scope
 * and how many definitions had been made) tells afterwards exactly what a lookup found at that
 * moment, though the scope went on to define more.
 */

import { primitiveNames } from '../../../foundation/language/primitives.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type {
  FunctionDeclaration,
  ImportDeclaration,
  ImportedAll,
  ImportedName,
} from '../../syntax/declarations/index.ts';
import type { Lambda } from '../../syntax/expressions/index.ts';
import type { Entity, PrimitiveEntity } from '../entities.ts';

/** `a`, or `a as b`, in `import a from 'path'`, until linking finds the export it names. */
export interface ImportPlaceholder {
  readonly kind: 'import';
  readonly imported: ImportedName;
  readonly declaration: ImportDeclaration;
}

const placeholders = new WeakMap<ImportedName, ImportPlaceholder>();

/**
 * The placeholder of `imported`, of `declaration`: one per name, as entities are (../entities.ts).
 */
export function importPlaceholder(
  imported: ImportedName,
  declaration: ImportDeclaration,
): ImportPlaceholder {
  return memo(placeholders, imported, () => ({ kind: 'import', imported, declaration }));
}

/** `*` in `import * from 'path'`, whose names linking binds (../link/star-imports.ts). */
export interface StarImport {
  readonly imported: ImportedAll;
  readonly declaration: ImportDeclaration;
}

export type LocalEntity = Entity | ImportPlaceholder;

export type Miss = 'pending' | 'ended' | 'underOr' | 'fenced';

type ScopedFunction = FunctionDeclaration | Lambda;

/**
 * The innermost function around a scope that is one of a set, and whether a transient's
 * initializer stands between, which sees none of its variables (§3.4).
 */
export interface Enclosing {
  readonly function: ScopedFunction;
  readonly fenced: boolean;
}

/** A scope as binding had defined it at one moment. */
export interface ScopeSnapshot {
  readonly scope: Scope;
  /** How many definitions the tree's scopes had made then. */
  readonly at: number;
}

/** The definitions of one tree's scopes, counted in the order they were made. */
interface Definitions {
  readonly entities: Set<LocalEntity>;
  count: number;
}

export class Scope {
  readonly #defined = new Map<string, LocalEntity>();
  /** The number of each name's definition. */
  readonly #numbers = new Map<string, number>();
  readonly #misses = new Map<string, Miss>();
  readonly #parent: Scope | undefined;
  readonly #definitions: Definitions;
  /** A block, the module or the universe receives the names of nested scopes that end. */
  readonly #isBlock: boolean;
  /** The function whose body this scope holds. */
  readonly #function: ScopedFunction | undefined;
  /** Whether lookups past this scope skip the variables of the functions around it. */
  readonly #fenced: boolean;
  /** Whether a function's names are defined here: anything but the universe and the module. */
  readonly #isLocal: boolean;

  private constructor(
    parent: Scope | undefined,
    isBlock: boolean,
    { node, fenced = false }: { readonly node?: ScopedFunction; readonly fenced?: boolean } = {},
  ) {
    this.#parent = parent;
    this.#isBlock = isBlock;
    this.#function = node;
    this.#fenced = fenced;
    this.#isLocal = parent !== undefined && parent.#parent !== undefined;
    this.#definitions =
      parent === undefined ? { entities: new Set(), count: 0 } : parent.#definitions;
  }

  /** The outermost scope, which has no parent. */
  static root(): Scope {
    return new Scope(undefined, true);
  }

  /** A scope for a block of statements, or for the module's top level. */
  static block(parent: Scope): Scope {
    return new Scope(parent, true);
  }

  /** A scope for bindings nested in a block: parameters, pattern bindings, loop variables. */
  static nested(parent: Scope): Scope {
    return new Scope(parent, false);
  }

  /**
   * A scope for a function's body, inside its parameters'. A parameter's default isn't in it: it
   * runs before the body starts (§3.3).
   */
  static ofBody(parent: Scope, node: ScopedFunction): Scope {
    return new Scope(parent, false, { node });
  }

  /** A scope for a transient's initializer (§3.4), fenced from its function's variables. */
  static fenced(parent: Scope): Scope {
    return new Scope(parent, false, { fenced: true });
  }

  /** The innermost function this scope is inside that is one of `functions`. */
  enclosingOf(functions: readonly ScopedFunction[]): Enclosing | undefined {
    return this.#enclosingOf(functions, false);
  }

  #enclosingOf(functions: readonly ScopedFunction[], fenced: boolean): Enclosing | undefined {
    const own = this.#function;
    if (own !== undefined && functions.includes(own)) {
      return { function: own, fenced };
    }
    return this.#parent === undefined
      ? undefined
      : this.#parent.#enclosingOf(functions, fenced || this.#fenced);
  }

  lookup(name: string): LocalEntity | undefined {
    const defining = this.#definingScope(name, false);
    return defining === undefined ? undefined : defining.#defined.get(name);
  }

  /** Whether `name` resolves here to what the module's top level defines. */
  resolvesAtTopLevel(name: string): boolean {
    const defining = this.#definingScope(name, false);
    return defining !== undefined && !defining.#isLocal && defining.#parent !== undefined;
  }

  /** The scope whose definition of `name` a lookup here finds. */
  #definingScope(name: string, fenced: boolean): Scope | undefined {
    const own = this.#defined.get(name);
    if (own !== undefined && !this.#hides(own, fenced)) {
      return this;
    }
    return this.#parent === undefined
      ? undefined
      : this.#parent.#definingScope(name, fenced || this.#fenced);
  }

  /** Why `name` resolves to nothing here, when some enclosing scope knows. */
  explainMiss(name: string): Miss | undefined {
    return this.#explainMiss(name, false);
  }

  #explainMiss(name: string, fenced: boolean): Miss | undefined {
    const own = this.#defined.get(name);
    if ((own !== undefined && this.#hides(own, fenced)) || (fenced && this.#misses.has(name))) {
      return 'fenced';
    }
    const missed = this.#misses.get(name);
    if (missed !== undefined || this.#parent === undefined) {
      return missed;
    }
    return this.#parent.#explainMiss(name, fenced || this.#fenced);
  }

  /** Whether a lookup past a fence skips `entity`, defined here: a function's variable. */
  #hides(entity: LocalEntity, fenced: boolean): boolean {
    return fenced && this.#isLocal && entity.kind === 'variable';
  }

  /** Defines `name`; false when this scope already defines it. */
  define(name: string, entity: LocalEntity): boolean {
    if (this.#defined.has(name)) {
      return false;
    }
    this.#defined.set(name, entity);
    this.#definitions.count += 1;
    this.#definitions.entities.add(entity);
    this.#numbers.set(name, this.#definitions.count);
    this.#misses.delete(name);
    return true;
  }

  /** This scope as it is defined now. */
  snapshot(): ScopeSnapshot {
    return { scope: this, at: this.#definitions.count };
  }

  /** Every entity this tree's scopes have defined, in any scope. */
  definedEntities(): ReadonlySet<LocalEntity> {
    return this.#definitions.entities;
  }

  /** What a lookup in `snapshot` found for each name: an inner definition hides an outer one. */
  static visibleIn({ scope, at }: ScopeSnapshot): ReadonlyMap<string, LocalEntity> {
    const visible = new Map<string, LocalEntity>();
    let fenced = false;
    for (let current: Scope | undefined = scope; current; current = current.#parent) {
      for (const [name, entity] of current.#defined) {
        const shown = !(visible.has(name) || current.#hides(entity, fenced));
        if (shown && (current.#numbers.get(name) ?? 0) <= at) {
          visible.set(name, entity);
        }
      }
      fenced ||= current.#fenced;
    }
    return visible;
  }

  /** Notes that a later statement of this block declares `name`. */
  expect(name: string): void {
    this.#noteMiss(name, 'pending');
  }

  /** Notes that one side of an `or` bound these names. */
  hideUnderOr(names: Iterable<string>): void {
    for (const name of names) {
      this.#noteMiss(name, 'underOr');
    }
  }

  /** Hands this scope's names to the enclosing block, which no longer sees them. */
  end(): void {
    this.endUpTo(this.#parent);
  }

  /** Ends this scope and every one between it and `ancestor`, such as a condition's bindings. */
  endUpTo(ancestor: Scope | undefined): void {
    for (let scope: Scope | undefined = this; scope && scope !== ancestor; scope = scope.#parent) {
      const parent = scope.#parent;
      if (parent !== undefined) {
        Scope.#nearestBlock(parent).#noteEnded(scope.#defined.keys());
      }
    }
  }

  /** The names defined by this scope and its ancestors below `ancestor`. */
  definedSince(ancestor: Scope): readonly string[] {
    const names: string[] = [];
    for (let scope: Scope | undefined = this; scope && scope !== ancestor; scope = scope.#parent) {
      names.push(...scope.#defined.keys());
    }
    return names;
  }

  static #nearestBlock(scope: Scope): Scope {
    return scope.#isBlock || scope.#parent === undefined
      ? scope
      : Scope.#nearestBlock(scope.#parent);
  }

  #noteEnded(names: Iterable<string>): void {
    for (const name of names) {
      this.#noteMiss(name, 'ended');
    }
  }

  #noteMiss(name: string, miss: Miss): void {
    if (!this.#misses.has(name)) {
      this.#misses.set(name, miss);
    }
  }
}

const primitives: readonly PrimitiveEntity[] = primitiveNames.map((name) => ({
  kind: 'primitive',
  name,
}));

/** The outermost scope: the primitive types (§2). */
export function universe(): Scope {
  const scope = Scope.root();
  for (const primitive of primitives) {
    scope.define(primitive.name, primitive);
  }
  return scope;
}
