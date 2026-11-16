/**
 * A future (§3.3): what an async call, a timer or a host gives. It settles once, and calls the
 * callbacks waiting on it then (settling.ts); an async call's knows its execution, which its
 * disposal stops.
 */

import type { Value } from '../../../definition/values/values.ts';
import type { Execution } from './execution.ts';
import { RunObject } from './run-object.ts';

export class Future extends RunObject {
  settled: boolean;
  value: Value = null;
  /** The closures called with its value once it settles, in the order they were added. */
  callbacks: Waiting[] = [];
  /** Whether a case waiting on it lost: one nothing waits on any more is then given up on (§8). */
  lost: boolean;
  /** What runs each time something comes to wait on it. */
  readonly onAwaited: Value[] = [];
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
    this.lost = false;
  }
}

/** A closure waiting on a future, and where it decides among what settles together (spec §8). */
export interface Waiting {
  readonly callback: Value;
  readonly rank: readonly bigint[];
  /** What the resolver the callback resolves stands for (prelude.ista `_standing`). */
  readonly standing: Value;
}
