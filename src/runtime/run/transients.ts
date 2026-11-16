/**
 * Transients (§3.4): the cell a call of a function shares with the calls it nests, by
 * `function:register`. Nested calls of the same function share it on, so each key keeps a stack,
 * innermost last, and each call's `return` takes back only its own.
 */

import type { Cell } from './objects/cell.ts';

export class Transients {
  readonly #shared = new Map<string, Cell[]>();

  /** The transient cell shared by the nearest call nesting this one of its function. */
  readonly transient = (key: string): Cell | undefined => this.#shared.get(key)?.at(-1);

  readonly shareTransient = (key: string, cell: Cell): void => {
    const shared = this.#shared.get(key) ?? [];
    shared.push(cell);
    this.#shared.set(key, shared);
  };

  readonly unshareTransient = (key: string, cell: Cell | undefined): void => {
    const shared = this.#shared.get(key);
    if (cell !== undefined && shared?.at(-1) === cell) {
      shared.pop();
    }
  };
}
