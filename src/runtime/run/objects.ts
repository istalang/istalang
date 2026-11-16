/**
 * The run's objects (ir-first design, decision 6): what a handle refers to, each with an identity
 * from its run's serial, so a newer object has the greater id and disposal rounds go newest first.
 *
 * - A **cell** holds one value: a variable passed by `&` or captured (§3.7, §3.14), a transient's
 *   (§3.4), or the struct behind a shared struct's handle (§3.18).
 * - A **resource** is a host type's value with a `dispose` (§7, §9).
 * - A **future** is what an async call, a timer or a host gives (§3.3); it settles once, and calls
 *   the callbacks waiting on it then.
 * - An **execution** runs one async call on its frame record (docs/arch/codegen.md): its handle is
 *   the call's (`_Call`, §7).
 * - A **weak reference** refers to a disposable without holding it (§7).
 * - A **mock** replaces its target's calls while it is held, in a Definition built to run tests
 *   (§10, mocks.ts).
 * - A **reference** is no object: a cell and a path into its value, as a `&` parameter takes it.
 *
 * Every object compares by identity as a handle does (definition/values/equality.ts): its `kind`
 * is `handle` and its `object` its id. `count` is its holders' count, kept only for what reaches a
 * disposable (lifetimes.ts).
 */

import type { Value } from '../../definition/values/values.ts';
import type { Instance } from './instances.ts';

/** A step into a value: its tuple's `elements` or its struct's or variant's `fields`, at a position. */
export type Step = readonly [part: 'elements' | 'fields', position: number];

/** What every object of a run has: its identity, and its holders' count when counted. */
export abstract class RunObject {
  readonly kind = 'handle';
  readonly object: number;
  count = 0;

  constructor(id: number) {
    this.object = id;
  }
}

export class Cell extends RunObject {
  value: Value;
  /** Whether what it holds is counted: its type reaches a disposable. */
  readonly counted: boolean;
  /** The entry of the `dispose` a shared struct's handle declares (§7), run as it is let go of. */
  readonly dispose: number | undefined;

  constructor(id: number, value: Value, counted: boolean, dispose?: number) {
    super(id);
    this.value = value;
    this.counted = counted;
    this.dispose = dispose;
  }
}

export class Resource extends RunObject {
  readonly type: number;
  readonly payload: unknown;
  disposed = false;

  constructor(id: number, type: number, payload: unknown) {
    super(id);
    this.type = type;
    this.payload = payload;
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

/** A closure waiting on a future, and where it decides among what settles together (spec §8). */
export interface Waiting {
  readonly callback: Value;
  readonly rank: readonly bigint[];
  /** What the resolver the callback resolves stands for (prelude.ista `_standing`). */
  readonly standing: Value;
}

export class Future extends RunObject {
  settled = false;
  value: Value = null;
  /** The closures called with its value once it settles, in the order they were added. */
  callbacks: Waiting[] = [];
  /** Whether a case waiting on it lost: one nothing waits on any more is then given up on (§8). */
  lost = false;
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
  }
}

export class Execution extends RunObject {
  frame!: Frame;
  readonly future: Future;
  /** The instance it runs in. */
  readonly instance: Instance;
  /** Whether it has returned or stopped. */
  ended = false;
  /** Whether it waits at a `park`, its frame saved. */
  parked = false;
  /** What its `disposing()` gives (§7), made the first time it is asked for. */
  disposing: Future | undefined;
  /** What it was called with, its closure among them, which it holds until it ends. */
  given: readonly Value[] = [];
  /** The position its wait was decided for as its call is disposed: its `disposing()` case's. */
  decidedDisposing: Value | undefined;

  constructor(id: number, futureId: number, instance: Instance) {
    super(id);
    this.future = new Future(futureId, this);
    this.instance = instance;
  }
}

export class WeakReference extends RunObject {
  target: RunObject | undefined;
  /** What its `disposed()` gives (§7), made the first time it is asked for. */
  disposed: Future | undefined;

  constructor(id: number, target: RunObject) {
    super(id);
    this.target = target;
  }
}

/** A `&` parameter's value: the place in `cell`'s value at `path`. */
/** A mock's handle (testing.ista `Mock<F>`): its target, its replacement and the calls it took. */
export class MockObject extends RunObject {
  readonly target: number;
  /** Set once, as it is made or as its snapshot is read back. */
  replacement: Value;
  /** Each call's arguments, a tuple per call, oldest first. */
  readonly calls: Value[] = [];

  constructor(id: number, target: number, replacement: Value) {
    super(id);
    this.target = target;
    this.replacement = replacement;
  }
}

export class Reference {
  readonly cell: Cell;
  readonly path: readonly Step[];

  constructor(cell: Cell, path: readonly Step[]) {
    this.cell = cell;
    this.path = path;
  }
}
