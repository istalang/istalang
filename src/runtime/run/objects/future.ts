/**
 * A future (§3.3): what an async call, a timer or a host gives. It settles once, and calls the
 * callbacks waiting on it then (settling.ts); an async call's knows its execution, which its
 * disposal stops. A widened call's is one of its own following the call's, which it settles with
 * converted (§3.14, ../following.ts), leaving the call's as it is.
 */

import type { Value } from '../../../definition/values/values.ts';
import type { Execution } from './execution.ts';
import { RunObject } from './run-object.ts';

/** A future followed, and the closure converting its value: a conversion's entry. */
export interface Following {
  readonly future: Future;
  readonly converter: Value;
}

export class Future extends RunObject {
  settled: boolean;
  value: Value = null;
  /** The closures called with its value once it settles, in the order they were added. */
  callbacks: Waiting[] = [];
  /** Whether a case waiting on it lost: one nothing waits on any more is then given up on (§8). */
  lost: boolean;
  /** The future it follows, until that settles, and what converts its value (../following.ts). */
  follows: Following | undefined;
  /** The futures following it, which settle as it does. */
  readonly followers: Future[] = [];
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

/** A closure waiting on a future, called with its value as it settles. */
export interface Waiting {
  readonly callback: Value;
  /** What the resolver the callback resolves stands for (prelude.ista `_standing`). */
  readonly standing: Value;
  /** What cancels that resolver, run if the future is disposed before it settles (§6). */
  readonly cancelled: Value;
}

/** The closures `waiting` holds, which its future holds while it waits. */
export function closuresOf({ callback, standing, cancelled }: Waiting): readonly Value[] {
  return [callback, standing, cancelled];
}
