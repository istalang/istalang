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
 *
 * During local binding, a named import is a placeholder: which entity it names is known only once
 * the program is linked.
 */

import { primitiveNames } from '../../language/primitives.ts';
import type { NamedImport } from '../syntax/declarations.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Entity, PrimitiveEntity } from './entities.ts';

/** `a` in `import a from 'path'`, until linking finds what it names. */
export interface ImportPlaceholder {
  readonly kind: 'import';
  readonly name: Identifier;
  readonly declaration: NamedImport;
}

export type LocalEntity = Entity | ImportPlaceholder;

export type Miss = 'pending' | 'ended' | 'underOr';

export class Scope {
  readonly #defined = new Map<string, LocalEntity>();
  readonly #misses = new Map<string, Miss>();
  readonly #parent: Scope | undefined;
  /** A block, the module or the universe receives the names of nested scopes that end. */
  readonly #isBlock: boolean;

  private constructor(parent: Scope | undefined, isBlock: boolean) {
    this.#parent = parent;
    this.#isBlock = isBlock;
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

  lookup(name: string): LocalEntity | undefined {
    return this.#defined.get(name) ?? this.#parent?.lookup(name);
  }

  /** Why `name` resolves to nothing here, when some enclosing scope knows. */
  explainMiss(name: string): Miss | undefined {
    return this.#misses.get(name) ?? this.#parent?.explainMiss(name);
  }

  /** Defines `name`; false when this scope already defines it. */
  define(name: string, entity: LocalEntity): boolean {
    if (this.#defined.has(name)) {
      return false;
    }
    this.#defined.set(name, entity);
    this.#misses.delete(name);
    return true;
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
