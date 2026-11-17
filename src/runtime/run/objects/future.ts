/**
 * A future (§3.3): what an async call, a timer or a host gives. It settles once, and calls what
 * the prelude keeps waiting on it then (`waiting`, settling.ts); an async call's knows its execution,
 * which its disposal stops.
 */

import type { Value } from '../../../definition/values/values.ts';
import type { Execution } from './execution.ts';
import { RunObject } from './run-object.ts';

export class Future extends RunObject {
  settled: boolean;
  value: Value = null;
  /** What waits on it, as the prelude keeps it, while it is pending. */
  waiting: Waiting | undefined;
  /** What of the run itself waits on it: a call into a context waits on its invocation's. */
  readonly listeners: ((value: Value) => void)[] = [];
  /** What the run does if it is disposed before it settles: a host's cancel (§9). */
  readonly cancels: (() => void)[] = [];
  /** The execution it is the future of, for an async call's. */
  readonly execution: Execution | undefined;

  constructor(id: number, execution?: Execution) {
    super(id);
    this.execution = execution;
    this.settled = false;
  }
}

/**
 * The future a watch gives (`disposed()`, `disposing()`): `kept`, or one `made` anew where there is
 * none or it was disposed. Nothing holds a watch's future between two waits on it, and a disposed
 * future is never given out again (§7).
 */
export function watchFuture(kept: Future | undefined, made: () => Future): Future {
  return kept === undefined || kept.disposed ? made() : kept;
}

/**
 * What waits on a pending future (prelude.ista `_Waiters`), with the closures the run calls as it
 * settles, with its value, or as it is disposed first.
 */
export interface Waiting {
  readonly waiters: Value;
  readonly arrived: Value;
  readonly disposed: Value;
}

/** What `waiting` holds, which its future holds while it is pending. */
export function waitingValues({ waiters, arrived, disposed }: Waiting): readonly Value[] {
  return [waiters, arrived, disposed];
}
