/** A `&` parameter's value (§3.14): no object, but a cell and a path of steps into its value. */

import type { Cell } from './cell.ts';

/** A `&` parameter's value: the place in `cell`'s value at `path`. */
export class Reference {
  readonly cell: Cell;
  readonly path: readonly Step[];

  constructor(cell: Cell, path: readonly Step[]) {
    this.cell = cell;
    this.path = path;
  }
}

/** A step into a value: its tuple's `elements` or its struct's or variant's `fields`, at a position. */
export type Step = readonly [part: 'elements' | 'fields', position: number];
