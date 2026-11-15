/**
 * A place passed by `&` in compiled code (§3.7): a cell, and a path into its value.
 *
 * Values are immutable to the program: a write copies along its path (`withPartAt`), and the
 * changes a native makes through a place copy what they change. Every write of a place goes through
 * here, so changing a value in place once only its holder holds it (tracker P51, js-codegen P3) is a
 * decision of this module alone.
 */

import {
  copiedMap,
  deleteEntryInPlace,
  setEntryInPlace,
} from '../../definition/values/equality.ts';
import { partAt, withPartAt } from '../../definition/values/parts.ts';
import { elementsOf, mapValueOf, type Value } from '../../definition/values/values.ts';
import type { ValueChanges } from '../../runtime/natives.ts';
import type { Cell } from './cell.ts';

export class Place {
  readonly cell: Cell;
  readonly path: readonly number[];

  constructor(cell: Cell, path: readonly number[]) {
    this.cell = cell;
    this.path = path;
  }

  /** The place `path` further in. */
  at(path: readonly number[]): Place {
    return new Place(this.cell, [...this.path, ...path]);
  }

  /** Its value. */
  read(): Value {
    return partAt(this.cell.v, this.path);
  }

  /** Writes `value` at it. */
  write(value: Value): void {
    this.cell.v = withPartAt(this.cell.v, this.path, value);
  }

  /** Writes `value` at `path` inside it. */
  writeAt(path: readonly number[], value: Value): void {
    this.cell.v = withPartAt(this.cell.v, [...this.path, ...path], value);
  }

  /** The changes a native makes through it, to the array or map it holds. */
  changes(): ValueChanges {
    const elements = (): Value[] => [...elementsOf(this.read())];
    const changedMap = (change: (map: ReturnType<typeof copiedMap>) => void): void => {
      const map = copiedMap(mapValueOf(this.read()));
      change(map);
      this.write(map);
    };
    return {
      push: (items) => {
        this.write({ kind: 'array', elements: [...elements(), ...items] });
      },
      pop: () => {
        const changed = elements();
        const last = changed.pop();
        this.write({ kind: 'array', elements: changed });
        return last;
      },
      reverse: () => {
        this.write({ kind: 'array', elements: elements().reverse() });
      },
      splice: (start, count, items) => {
        const changed = elements();
        changed.splice(start, count, ...items);
        this.write({ kind: 'array', elements: changed });
      },
      setEntry: (key, value) => {
        changedMap((map) => setEntryInPlace(map, key, value));
      },
      deleteEntry: (key) => {
        let had = false;
        changedMap((map) => {
          had = deleteEntryInPlace(map, key) !== undefined;
        });
        return had;
      },
    };
  }
}
