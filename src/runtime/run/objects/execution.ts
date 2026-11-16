/**
 * An execution runs one async call on its frame record (docs/arch/codegen.md, executions.ts): its
 * handle is the call's (`_Call`, §7), and its future what the call gives.
 */

import type { Value } from '../../../definition/values/values.ts';
import type { Instance } from '../instances.ts';
import { TransientScope } from '../transient-scope.ts';
import { Future } from './future.ts';
import { RunObject } from './run-object.ts';

export class Execution extends RunObject {
  frame!: Frame;
  readonly future: Future;
  /** The instance it runs in. */
  readonly instance: Instance;
  /** Whether it has returned or stopped. */
  ended: boolean;
  /** Whether it waits at a `park`, its frame saved. */
  parked: boolean;
  /** What its `disposing()` gives (§7), made the first time it is asked for. */
  disposing: Future | undefined;
  /** What it was called with, its closure among them, which it holds until it ends. */
  given: readonly Value[] = [];
  /** The transients' cells its code sees (§3.4): those visible where it started, then its calls'. */
  transients = new TransientScope();
  /** The position its wait was decided for as its call is disposed: its `disposing()` case's. */
  decidedDisposing: Value | undefined;

  constructor(id: number, futureId: number, instance: Instance) {
    super(id);
    this.future = new Future(futureId, this);
    this.instance = instance;
    this.ended = false;
    this.parked = false;
  }
}

/** A frame record (definition/instructions/suspension.ts): an async entry's, parked or running. */
export interface Frame {
  readonly function: number;
  pc: number;
  registers: (Value | undefined)[];
  readonly closure: Value | undefined;
  decision: Value | undefined;
  readonly execution: Execution;
  stopping: boolean;
}
