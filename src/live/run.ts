/**
 * One run of a compiled program (docs/work/js-codegen/design.md): what its code calls as `run`, in
 * memory, from its root's call to its end, as the interpreter's live run (proposal 8, Rule 7).
 *
 * - **Executions:** the root, each live async call and each readied callback runs as an execution
 *   of its own, and `at` says which runs now: its waits are ordered by its creation, and it sees the
 *   transients its caller saw. An async call's body is a generator the run drives
 *   (executions.ts).
 * - **Readied work,** waiters whose wait was decided and calls resolvers readied (`Resolver.of`
 *   and `onCancel` callbacks), runs from the run's ready queue (ready.ts), one at a time in the
 *   order it became ready, as the interpreter's does.
 * - **Lifetimes:** the run makes every counted object (lifetimes/), and collects what lost its last
 *   holder after each piece of work it runs on its own: a readied one, a host's answer, timers
 *   coming due. Compiled code collects after its own instructions.
 * - **Its end:** its root's return, encoded as the start's encoder says (§9), or a panic, a limit
 *   the engine ran into included (`panicOf`). Nothing runs after it: a resumed execution returns,
 *   and nothing more arrives. Anything else thrown is a bug in the toolchain, which fails the run's
 *   promise with it.
 * - **Recursion** runs on the JavaScript stack, so a call nesting deeper than it allows panics
 *   saying so, where the interpreter's heap frames allow 200,000.
 */

import type { Value } from '../definition/values/values.ts';
import { closureOf } from '../definition/values/values.ts';
import { unreachable } from '../foundation/structures/unreachable.ts';
import type { Clock } from '../runtime/clock.ts';
import type { LogRecord } from '../runtime/instance-state.ts';
import { countsHoldersOf } from '../runtime/lifetimes/counts.ts';
import { type Natives, Panic, panicOf } from '../runtime/natives.ts';
import { Arrivals } from './arrivals.ts';
import { type Body, Executions } from './executions.ts';
import type { Counted } from './lifetimes/holdings.ts';
import { type RunLifetimes, runLifetimes } from './lifetimes/run-lifetimes.ts';
import { LiveWeakSide } from './lifetimes/weak-side.ts';
import { boundExtern } from './natives-context.ts';
import type { ExternShape, LiveFunction, ProgramTables } from './program-tables.ts';
import { Ready } from './ready.ts';
import { type At, sharing, transientIn } from './running.ts';
import { Timers } from './timers.ts';
import { Traces } from './traces.ts';
import { Cell, newObject } from './values/cell.ts';
import { helpers } from './values/helpers.ts';
import { Resource } from './values/resource.ts';
import { Future, type FutureOrigin } from './waits/future.ts';
import { Wait } from './waits/wait.ts';
import { Waits } from './waits/waits.ts';

/** How a run ended: its root's outcome, encoded as JSON, or a panic. */
export type RunEnd =
  | { readonly kind: 'finished'; readonly encoded: Value }
  | { readonly kind: 'panicked'; readonly message: string; readonly trace: string };

export type LiveProgramTables = ProgramTables<Run, typeof helpers>;

/** What a run is given. */
export interface RunSeams {
  readonly program: LiveProgramTables;
  readonly natives: Natives;
  readonly clock: Clock;
  /** The run's name, as its host gave it, which `runtime.id()` reads. */
  readonly name: string;
  readonly seed: Uint8Array;
  readonly ended: (end: RunEnd) => void;
  /** A bug in the toolchain stopped the run. */
  readonly broke: (error: unknown) => void;
}

export class Run {
  /** Why the run stopped, once it has: its end, or a bug. */
  #stopped: 'ended' | 'broken' | undefined;
  at: At = { execution: newObject(), call: undefined, scope: undefined };
  readonly seams: RunSeams;
  readonly waits: Waits;
  readonly weak: LiveWeakSide;
  readonly lifetimes: RunLifetimes<At>;
  readonly arrivals: Arrivals;
  readonly traces: Traces;
  readonly logs: LogRecord[] = [];
  readonly functions: readonly LiveFunction[];
  readonly #executions: Executions<At>;
  #root: { readonly future: Future; readonly encoder: number } | undefined;
  readonly #contextConstants = new Map<string, Value>();
  readonly #ready = new Ready();
  readonly #timers = new Timers();
  /** What tells each pending host future's host it was disposed unresolved. */
  readonly #hostDisposals = new Map<Future, () => void>();

  /** Whether the run stopped: nothing of it runs any more. */
  get ended(): boolean {
    return this.#stopped !== undefined;
  }

  constructor(seams: RunSeams) {
    this.seams = seams;
    this.waits = new Waits({
      called: (callback, argumentValues) => {
        this.#readyCallback(callback, argumentValues);
      },
      resumed: (resume) => {
        this.#ready.add(() => this.#onItsOwn(resume));
      },
      made: (resolver) => this.lifetimes.made(resolver),
      touched: (object) => {
        this.lifetimes.touch(object);
      },
      watchesCall: (call, future) => this.weak.watchesCall(call, future),
    });
    this.weak = new LiveWeakSide({
      watchFuture: () => this.future('watch'),
      resolvedFuture: () => this.resolvedFuture(null),
      resolveTogether: (futures) => this.#resolveWithNothing(futures),
      holdersOf: (object) => this.lifetimes.holdersOf(object),
    });
    this.#executions = new Executions<At>(this);
    this.lifetimes = runLifetimes({
      types: seams.program.types,
      waits: this.waits,
      executions: this.#executions,
      weak: this.weak,
      functions: () => this.functions,
      hostDisposed: (future) => {
        this.#hostDisposals.get(future)?.();
      },
      gone: (object) => {
        this.#gone(object);
      },
    });
    this.arrivals = new Arrivals(seams.clock, {
      next: () => this.#timers.next(),
      resolveDue: () => {
        this.#onItsOwn(() => this.#resolveDue());
      },
    });
    this.traces = new Traces(seams.program);
    this.functions = seams.program.code(this, helpers);
  }

  /** Calls `entry` with `argumentValues` as the run's root, its outcome encoded by `encoder`. */
  start(entry: number, argumentValues: readonly Value[], encoder: number): void {
    this.#onItsOwn(() => {
      const outcome = this.#call(entry, argumentValues);
      const future = outcome instanceof Future ? outcome : this.resolvedFuture(outcome as Value);
      this.lifetimes.hold(future);
      this.#root = { future, encoder };
    });
  }

  /** Applies `event`, something reaching the run from outside, in a turn of its own. */
  arrive(event: () => void): void {
    this.arrivals.arrive(() => this.#onItsOwn(event));
  }

  /** The function bound to extern entry `index`. */
  extern(index: number): LiveFunction {
    return boundExtern(this, this.seams.program.functions[index] as ExternShape);
  }

  /** Runs `body`, the async call of `call`, a new execution, up to its first wait. */
  call(call: Future, body: Body): void {
    this.#executions.call(call, body, { execution: call.object, call, scope: this.at.scope });
  }

  /** The weak reference to the running call (`currentCall`), which `disposing()` watches. */
  currentCall(): Value {
    return this.weak.reference(this.at.call ?? unreachable('Only an async call reads its call.'));
  }

  /**
   * Resolves `future` with `value`, as an async call returns; a call returning from its cleanup,
   * disposed, settles nothing, what it gives disposed as its variables are (§7).
   */
  settle(future: Future, value: Value): void {
    if (!this.#executions.cleaning(future)) {
      this.waits.resolveTogether([[future, value]]);
    }
  }

  /** The call of future `call` returned or was stopped, so it can no longer be disposed. */
  callEnded(call: Future): void {
    this.weak.returned(call);
  }

  /** A new future, filled as `origin` says. */
  future(origin: FutureOrigin): Future {
    return this.lifetimes.made(new Future(origin));
  }

  /** A new future, resolved with `value`. */
  resolvedFuture(value: Value): Future {
    const future = this.future('given');
    this.waits.resolveTogether([[future, value]]);
    return future;
  }

  /** A pending future a host resolves, `disposed` telling the host once it is disposed. */
  hostFuture(disposed: () => void): Future {
    const future = this.future('host');
    this.#hostDisposals.set(future, disposed);
    return future;
  }

  /** A new cell of entry `type` holding `value`, counted as its type entry says, or `counted`. */
  cell(
    type: number,
    value: Value,
    counted = countsHoldersOf(this.seams.program.types, type),
  ): Cell {
    const { lifetimes } = this;
    return counted ? lifetimes.madeCell(new Cell(type, value, lifetimes)) : new Cell(type, value);
  }

  /**
   * A cell register holding `cell`, a cell of entry `type`, writes `value`: the cell, made by its
   * first write, counted as lowering counts the register (`counted`).
   */
  cellWrite(cell: Cell | undefined, type: number, value: Value, counted: boolean): Cell {
    if (cell === undefined) {
      return this.lifetimes.swap(undefined, this.cell(type, value, counted));
    }
    cell.v = value;
    return cell;
  }

  /** A new resource of the host type entry `type`, holding `payload`. */
  resource(type: number, payload: unknown): Resource {
    const resource = new Resource(type, payload);
    return countsHoldersOf(this.seams.program.types, type)
      ? this.lifetimes.made(resource)
      : resource;
  }

  /** A new wait of the running execution. */
  wait(): Wait {
    return this.lifetimes.made(new Wait(this.at.execution, this.at.call));
  }

  contextConstant(name: string): Value | undefined {
    return this.#contextConstants.get(name);
  }

  /** Makes context constant `name`, which the run holds for its whole life. */
  makeContextConstant(name: string, value: Value): void {
    if (this.#contextConstants.has(name)) {
      throw new Panic(`The context constant '${name}' is read while it is being made.`);
    }
    this.lifetimes.hold(value);
    this.#contextConstants.set(name, value);
  }

  /** The cell of entry `entry`'s transient in `register` the running execution sees, if any. */
  transient(entry: number, register: number): Cell | undefined {
    return transientIn(this.at, entry, register);
  }

  /** `cell`, entry `entry`'s new transient in `register`, is seen by the calls nested in this one. */
  share(entry: number, register: number, cell: Cell): void {
    this.at = sharing(this.at, entry, register, cell);
  }

  /** A future that resolves at `at`, in milliseconds since the Unix epoch, with the others due then. */
  timer(at: bigint): Future {
    const future = this.future('timer');
    this.#timers.add(at, future);
    this.arrivals.timersChanged();
    return future;
  }

  /** Ends the run with the panic `error` stands for, or as broken by a bug. */
  fail(error: unknown): void {
    if (this.ended) {
      return;
    }
    const panic = panicOf(error);
    if (panic === undefined) {
      this.#stop('broken');
      this.seams.broke(error);
      return;
    }
    const stack = error instanceof Error ? error.stack : undefined;
    this.#end({
      kind: 'panicked',
      message: panic.message,
      trace: panic.trace ?? this.traces.of(stack),
    });
  }

  /**
   * Runs `work`, which the run runs on its own rather than compiled code calling it, then collects
   * what it let go of, and finishes once its root returned; what it threw ends the run.
   */
  #onItsOwn(work: () => void): void {
    try {
      work();
      if (!this.#finishedOnceReturned()) {
        this.#collected();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** Disposes what lost its last holder, if anything may have. */
  #collected(): void {
    if (this.lifetimes.due) {
      this.lifetimes.collect();
    }
  }

  /** Readies a call of the function value `callback`, which holds what it calls with meanwhile. */
  #readyCallback(callback: Value, argumentValues: readonly Value[]): void {
    const held = [callback, ...argumentValues];
    for (const value of held) {
      this.lifetimes.hold(value);
    }
    const letGo = (): void => {
      for (const value of held) {
        this.lifetimes.release(value);
      }
    };
    this.#ready.add(
      () =>
        this.#onItsOwn(() => {
          this.#callback(callback, argumentValues);
          letGo();
        }),
      letGo,
    );
  }

  /** Calls the function value `callback` with `argumentValues`, an execution of its own. */
  #callback(callback: Value, argumentValues: readonly Value[]): void {
    if (this.ended) {
      return;
    }
    const caller = this.at;
    this.at = { execution: newObject(), call: undefined, scope: undefined };
    try {
      const closure = closureOf(callback) ?? unreachable('A callback is a function value.');
      (this.functions[closure.function] as LiveFunction)(closure, ...argumentValues);
    } finally {
      this.at = caller;
    }
  }

  #call(entry: number, argumentValues: readonly Value[]): unknown {
    return (this.functions[entry] as LiveFunction)(null, ...argumentValues);
  }

  /**
   * Once the root's call returned, encodes its outcome, lets go of everything the run still holds,
   * what the root's own return let go of among it, as the interpreter does as an instance finishes
   * (§3.12, §7), and ends the run; whether it did.
   */
  #finishedOnceReturned(): boolean {
    const root = this.#root;
    const settled = root?.future.settled;
    if (root === undefined || settled === undefined || this.ended) {
      return false;
    }
    // The interpreter encodes before the root's frame lets go, so nothing is disposed in between.
    const encoded = this.lifetimes.deferring(() => this.#call(root.encoder, [settled.value]));
    this.#letGoOfTheRest(root.future);
    this.#end({ kind: 'finished', encoded: encoded as Value });
    return true;
  }

  /**
   * Lets go of what the run holds once its root returned: what it readied but never ran, its root's
   * future, any call still suspended, and its context constants last (§3.4), collecting after each.
   */
  #letGoOfTheRest(root: Future): void {
    this.#ready.close();
    this.lifetimes.release(root);
    this.#collected();
    this.#executions.stopSuspended();
    this.#collected();
    for (const value of [...this.#contextConstants.values()].toReversed()) {
      this.lifetimes.release(value);
      this.#collected();
    }
  }

  /** Resolves the timers due by the clock, each instant's together, the earliest first. */
  #resolveDue(): void {
    for (const futures of this.#timers.takeDue(this.seams.clock.now())) {
      this.#resolveWithNothing(futures);
    }
  }

  /** Resolves `futures` together, each with nothing: timers come due, watches of what is gone. */
  #resolveWithNothing(futures: readonly Future[]): void {
    this.waits.resolveTogether(futures.map((future) => [future, null] as const));
  }

  /** `object` is gone: a timer nothing awaits no longer wakes the run, a host's no longer tells. */
  #gone(object: Counted): void {
    if (!(object instanceof Future)) {
      return;
    }
    this.#hostDisposals.delete(object);
    if (object.origin === 'timer') {
      this.#timers.remove(object);
      this.arrivals.timersChanged();
    }
  }

  #end(end: RunEnd): void {
    this.#stop('ended');
    this.seams.ended(end);
  }

  #stop(why: 'ended' | 'broken'): void {
    this.#stopped = why;
    this.#ready.stop();
    this.arrivals.stop();
  }
}
