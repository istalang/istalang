/**
 * A cell of compiled code (docs/work/js-codegen/design.md, "Registers"): a cell register's shared
 * variable, or the cell behind a shared struct's handle (§3.18).
 *
 * - A cell is a handle: it compares by identity (`==`, §3.9) through its `object`, so `valuesEqual`
 *   and the natives read it as any handle. Every object of a run that a handle names takes its
 *   identity from `newObject`, so no two compare equal, and a newer one has the greater identity.
 * - A cell of a counted type (runtime/lifetimes/counts.ts `countsHoldersOf`) holds its value as a
 *   holder whose writes are counted (live/lifetimes/): every write, through a place or not, goes
 *   through `v`.
 */

import type { Value } from '../../definition/values/values.ts';

let made = 0;

/** A new object's identity, for handles to compare by. */
export function newObject(): number {
  made += 1;
  return made;
}

/** What a counted cell reports its writes to. */
export interface CellHolder {
  /** The cell let go of `was` for `now`. */
  readonly swap: (was: Value, now: Value) => void;
}

export class Cell {
  readonly kind = 'handle';
  readonly object = newObject();
  /** The cell entry it is made as. */
  readonly type: number;
  #value: Value;
  readonly #holder: CellHolder | undefined;

  /** A cell of entry `type` holding `value`, counted when `holder` hears its writes. */
  constructor(type: number, value: Value, holder?: CellHolder) {
    this.type = type;
    this.#value = value;
    this.#holder = holder;
  }

  get v(): Value {
    return this.#value;
  }

  set v(value: Value) {
    this.#holder?.swap(this.#value, value);
    this.#value = value;
  }
}
