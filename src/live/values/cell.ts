/**
 * A cell of compiled code (docs/work/js-codegen/design.md, "Registers"): a cell register's shared
 * variable, or the cell behind a shared struct's handle (§3.18).
 *
 * A cell is a handle: it compares by identity (`==`, §3.9) through its `object`, so `valuesEqual`
 * and the natives read it as any handle. Every object of a run that a handle names takes its
 * identity from `newObject`, so no two compare equal.
 */

import type { Value } from '../../definition/values/values.ts';

let made = 0;

/** A new object's identity, for handles to compare by. */
export function newObject(): number {
  made += 1;
  return made;
}

export class Cell {
  readonly kind = 'handle';
  readonly object = newObject();
  v: Value;

  constructor(value: Value) {
    this.v = value;
  }
}
