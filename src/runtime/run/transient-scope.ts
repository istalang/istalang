/**
 * The transients' cells code running in one execution sees (§3.4; transients.ts): the shares of
 * each transient, by function and register, innermost last, starting from what its execution kept.
 */

import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Cell } from './objects/cell.ts';

/** A transient's cell an execution keeps, visible where it started. */
interface KeptTransient {
  readonly function: FunctionId;
  readonly register: Register;
  readonly cell: Cell;
}

/** The shares of one transient: the cells of the calls sharing it, innermost last. */
interface Shares {
  readonly function: FunctionId;
  readonly register: Register;
  readonly cells: Cell[];
}

/** The transients' cells code running in one execution sees. */
export class TransientScope {
  /** The cells visible where its execution started, which it holds until it ends. */
  readonly kept: readonly KeptTransient[];
  readonly #shares = new Map<string, Shares>();

  constructor(kept: readonly KeptTransient[] = []) {
    this.kept = kept;
    for (const each of kept) {
      this.share(each.function, each.register, each.cell);
    }
  }

  /** The cell of the transient in `register` of `function` that the innermost call sharing it shares. */
  visible(function_: FunctionId, register: Register): Cell | undefined {
    return this.#shares.get(keyOf(function_, register))?.cells.at(-1);
  }

  /** `cell`, shared by one more call, the innermost. */
  share(function_: FunctionId, register: Register, cell: Cell): void {
    const key = keyOf(function_, register);
    const shares = this.#shares.get(key);
    if (shares === undefined) {
      this.#shares.set(key, { function: function_, register, cells: [cell] });
    } else {
      shares.cells.push(cell);
    }
  }

  /** Takes back the innermost call's share of `cell`; whether it shared it. */
  unshare(function_: FunctionId, register: Register, cell: Cell): boolean {
    const key = keyOf(function_, register);
    const shares = this.#shares.get(key);
    if (shares?.cells.at(-1) !== cell) {
      return false;
    }
    shares.cells.pop();
    if (shares.cells.length === 0) {
      this.#shares.delete(key);
    }
    return true;
  }

  /** The visible cell of every transient: what an execution started here keeps. */
  visibleCells(): KeptTransient[] {
    return [...this.#shares.values()].map(({ function: function_, register, cells }) => ({
      function: function_,
      register,
      cell: cells.at(-1) as Cell,
    }));
  }

  /** The counted cells it still holds, kept or shared, which its execution lets go of as it ends. */
  held(): Cell[] {
    return [...this.#shares.values()].flatMap(({ cells }) => cells.filter(isCounted));
  }
}

function keyOf(function_: FunctionId, register: Register): string {
  return `${function_}:${register}`;
}

function isCounted(cell: Cell): boolean {
  return cell.counted;
}
