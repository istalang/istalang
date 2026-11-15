/**
 * Which execution of a run of compiled code runs, and the transients it sees (spec §3.4): a
 * transient's cell is seen by the calls nested in the one that made it, an async callee's included,
 * through a chain each execution carries.
 */

import type { Cell } from './values/cell.ts';
import type { Future } from './waits/future.ts';

/** A transient's cell, seen by the calls nested in the one that made it. */
interface Scope {
  readonly entry: number;
  readonly register: number;
  readonly cell: Cell;
  readonly next: Scope | undefined;
}

/** Which execution runs: its creation, its call's future (none for a callback's), what it sees. */
export interface At {
  readonly execution: number;
  readonly call: Future | undefined;
  readonly scope: Scope | undefined;
}

/** The cell of entry `entry`'s transient in `register` that `at` sees, if any. */
export function transientIn(at: At, entry: number, register: number): Cell | undefined {
  let { scope } = at;
  while (scope !== undefined && (scope.entry !== entry || scope.register !== register)) {
    ({ next: scope } = scope);
  }
  return scope?.cell;
}

/** `at`, seeing `cell`, entry `entry`'s new transient in `register`, as the calls in it do. */
export function sharing(at: At, entry: number, register: number, cell: Cell): At {
  return { ...at, scope: { entry, register, cell, next: at.scope } };
}
