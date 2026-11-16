/**
 * Places (§3.5) as compiled code reads and writes them: a root, a register's value, a cell or a
 * reference, and a path of steps below it. Codegen knows each place's root kind, so it calls the
 * helper of that kind and nothing branches on it here.
 *
 * - Writing one changes each value along the path in place where it is unique, else in a copy that
 *   takes its place (lifetimes.ts `withPart`): a register's root is the new value given back, a
 *   cell's is changed inside the cell.
 * - A reference is a cell and a path into its value, so a place rooted at a register has none to
 *   refer into: lowering gives a `&` of a local its own cell.
 */

import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Lifetimes } from './lifetimes.ts';
import type { Cell } from './objects/cell.ts';
import { Reference, type Step } from './objects/reference.ts';

/** What a place is rooted at. */
type PlaceRoot = 'register' | 'cell' | 'reference';

/** The value at a reference's place, as a native taking it by `&` reads it. */
export function deref(reference: Reference): Value {
  return valueAt(reference.cell.value, reference.path);
}

/** The helpers compiled code reads and writes places with, over the run's lifetimes. */
export class Places {
  readonly #lifetimes: Lifetimes;

  constructor(lifetimes: Lifetimes) {
    this.#lifetimes = lifetimes;
  }

  readonly load = load;

  /** `root`, a register's value, with `value` moved into its part at `path`: the root's new value. */
  readonly storeRegister = (
    root: Value,
    path: readonly Step[],
    value: Value,
    counted: boolean,
  ): Value => this.#lifetimes.withPart(root, path, value, counted);

  /** Moves `value` into the part at `path` of `cell`'s value. */
  readonly storeCell = (
    cell: Cell,
    path: readonly Step[],
    value: Value,
    counted: boolean,
  ): void => {
    cell.value = this.#lifetimes.withPart(cell.value, path, value, counted);
  };

  /** Moves `value` into the part at `path` of the place `reference` refers to. */
  readonly storeReference = (
    reference: Reference,
    path: readonly Step[],
    value: Value,
    counted: boolean,
  ): void => {
    this.storeCell(reference.cell, [...reference.path, ...path], value, counted);
  };

  readonly reference = referenceTo;
}

/** The value of a place's root of each kind. */
const rootValues = {
  register: (root) => root,
  cell: (root) => (root as unknown as Cell).value,
  reference: (root) => deref(root as unknown as Reference),
} satisfies Record<PlaceRoot, (root: Value) => Value>;

/** The value at `path` in the place a root of `kind` in `root` reaches. */
function load(kind: PlaceRoot, root: Value, path: readonly Step[]): Value {
  return valueAt(rootValues[kind](root), path);
}

/** A reference to the place at `path` of a cell or of another reference's place. */
function referenceTo(kind: PlaceRoot, root: Value, path: readonly Step[]): Reference {
  if (kind === 'cell') {
    return new Reference(root as unknown as Cell, path);
  }
  if (kind === 'reference') {
    const outer = root as unknown as Reference;
    return new Reference(outer.cell, [...outer.path, ...path]);
  }
  return unreachable('A place rooted at a register has no cell to refer into.');
}

function valueAt(root: Value, path: readonly Step[]): Value {
  let value = root;
  for (const [part, position] of path) {
    value = ((value as unknown as Record<string, Value[]>)[part] ?? [])[position] ?? null;
  }
  return value;
}
