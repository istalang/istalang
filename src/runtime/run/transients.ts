/**
 * Transients (§7.1): the cell the outermost call of a function makes for each of its transients,
 * which every call nested in it shares, by function and register.
 *
 * - **Scopes.** Code sees its execution's scope, or the run's own outside every execution. A scope
 *   starts from the cells visible where its execution started (`kept`), and each call sharing one
 *   shares it on, innermost last, its `return` taking back only its own. So an async call nested in
 *   the outermost one finds its cell however late it runs, and another instance, whose executions
 *   are its own, starts afresh.
 * - **Holders** (§16): each share holds the cell, the making call's by the hold the cell is made
 *   with, and an execution holds what it kept until it ends, so the cell is let go of as the last
 *   of them ends. A cell of uncounted type is never counted.
 * - **Snapshots** keep each execution's `kept`; its frame's own shares are its transient registers,
 *   which it is read back with (snapshot/restore.ts).
 */

import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Cell } from './objects/cell.ts';
import type { Run } from './run.ts';
import { TransientScope } from './transient-scope.ts';

/** The run's transients, as compiled code shares them (codegen/instructions.ts). */
export class Transients {
  readonly #outside = new TransientScope();
  readonly #run: Pick<Run, 'executions' | 'lifetimes'>;

  /** Of `run`, whose parts it reads as code runs, once they are made. */
  constructor(run: Pick<Run, 'executions' | 'lifetimes'>) {
    this.#run = run;
  }

  /**
   * The cell a call this one is nested in shares of the transient in `register` of `function`,
   * shared on by this call and held by it; undefined where none has made it.
   */
  readonly sharedTransient = (function_: FunctionId, register: Register): Cell | undefined => {
    const scope = this.#scope();
    const cell = scope.visible(function_, register);
    if (cell !== undefined) {
      this.#hold(cell);
      scope.share(function_, register, cell);
    }
    return cell;
  };

  /** Shares `cell`, which this call just made, with the calls nested in it. */
  readonly shareTransient = (function_: FunctionId, register: Register, cell: Cell): void => {
    this.#scope().share(function_, register, cell);
  };

  /** Takes back this call's share of `cell` as it returns, letting go of it. */
  readonly unshareTransient = (
    function_: FunctionId,
    register: Register,
    cell: Cell | undefined,
  ): void => {
    if (cell !== undefined && this.#scope().unshare(function_, register, cell) && cell.counted) {
      this.#run.lifetimes.letGo(cell);
    }
  };

  /** The scope of an execution starting now: the cells visible here, each held by it. */
  started(): TransientScope {
    const kept = this.#scope().visibleCells();
    for (const { cell } of kept) {
      this.#hold(cell);
    }
    return new TransientScope(kept);
  }

  #scope(): TransientScope {
    return this.#run.executions.current()?.transients ?? this.#outside;
  }

  #hold(cell: Cell): void {
    if (cell.counted) {
      this.#run.lifetimes.hold(cell);
    }
  }
}
