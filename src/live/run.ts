/**
 * One run of a compiled program (docs/work/js-codegen/design.md): what its code calls as `run`, in
 * memory, from its root's call to its end, as the interpreter's live run (proposal 8, Rule 7).
 *
 * - **Executions:** the root, each live async call and each readied callback runs as an execution
 *   of its own, and `at` says which runs now: its waits are ordered by its creation, and it sees the
 *   transients its caller saw. Compiled code sets it as an execution begins and resumes.
 * - **Readied calls** (`Resolver.of` callbacks, `onCancel` ones) run as microtasks, after whatever
 *   was readied before, as the interpreter's ready queue runs them.
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
import { type Natives, Panic, panicOf } from '../runtime/natives.ts';
import { Arrivals } from './arrivals.ts';
import { boundExtern } from './natives-context.ts';
import type { ExternShape, LiveFunction, ProgramTables } from './program-tables.ts';
import { Slots } from './slots/slots.ts';
import { Traces } from './traces.ts';
import { type Cell, newObject } from './values/cell.ts';
import { helpers } from './values/helpers.ts';
import { Future } from './waits/future.ts';
import type { Resolver } from './waits/resolver.ts';
import { type Decision, Wait } from './waits/wait.ts';
import { Waits } from './waits/waits.ts';

/** A transient's cell, seen by the calls nested in the one that made it (spec §3.4). */
interface Scope {
  readonly entry: number;
  readonly cell: Cell;
  readonly next: Scope | undefined;
}

/** Which execution runs: its creation, its call's future (none for a callback's), what it sees. */
export interface At {
  readonly execution: number;
  readonly call: Future | undefined;
  readonly scope: Scope | undefined;
}

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
  readonly slots: Slots;
  readonly arrivals: Arrivals;
  readonly traces: Traces;
  readonly logs: LogRecord[] = [];
  readonly functions: readonly LiveFunction[];
  #root: { readonly future: Future; readonly encoder: number } | undefined;
  readonly #contextConstants = new Map<string, Value>();
  readonly #timers = new Map<bigint, Future[]>();

  /** Whether the run stopped: nothing of it runs any more. */
  get ended(): boolean {
    return this.#stopped !== undefined;
  }

  constructor(seams: RunSeams) {
    this.seams = seams;
    this.waits = new Waits({
      called: (callback, argumentValues) => {
        queueMicrotask(() => this.#callback(callback, argumentValues));
      },
      awaited: (future) => this.slots.awaited(future),
    });
    this.slots = new Slots(this.waits);
    this.arrivals = new Arrivals(seams.clock);
    this.traces = new Traces(seams.program);
    this.functions = seams.program.code(this, helpers);
  }

  /** Calls `entry` with `argumentValues` as the run's root, its outcome encoded by `encoder`. */
  start(entry: number, argumentValues: readonly Value[], encoder: number): void {
    try {
      const outcome = this.#call(entry, argumentValues);
      if (outcome instanceof Future) {
        this.#root = { future: outcome, encoder };
        if (outcome.settled !== undefined) {
          this.#finish(outcome.settled.value);
        }
      } else {
        this.#root = { future: new Future(), encoder };
        this.#finish(outcome as Value);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  /** The function bound to extern entry `index`. */
  extern(index: number): LiveFunction {
    return boundExtern(this, this.seams.program.functions[index] as ExternShape);
  }

  /** The async call of `call`, a new execution, begins; the execution that called it. */
  begin(call: Future): At {
    const caller = this.at;
    this.at = { execution: call.object, call, scope: caller.scope };
    return caller;
  }

  /** Resolves `future` with `value`, as an async call returns. */
  settle(future: Future, value: Value): void {
    this.waits.resolveTogether([[future, value]]);
    if (future === this.#root?.future) {
      this.#finish(value);
    }
  }

  /** A new wait of the running execution. */
  wait(): Wait {
    return new Wait(this.at.execution);
  }

  /** A new resolver of `wait`'s case `position`. */
  resolver(wait: Wait, position: number): Resolver {
    return this.waits.resolver(wait, position);
  }

  /** How `wait`, a `select`'s that doesn't wait, was decided; none when it wasn't, withdrawn. */
  selection(wait: Wait): Decision | undefined {
    return this.waits.endNonBlocking(wait);
  }

  contextConstant(name: string): Value | undefined {
    return this.#contextConstants.get(name);
  }

  makeContextConstant(name: string, value: Value): void {
    if (this.#contextConstants.has(name)) {
      throw new Panic(`The context constant '${name}' is read while it is being made.`);
    }
    this.#contextConstants.set(name, value);
  }

  /** The cell of entry `entry`'s transient the running execution sees, if any. */
  transient(entry: number): Cell | undefined {
    let { scope } = this.at;
    while (scope !== undefined && scope.entry !== entry) {
      ({ next: scope } = scope);
    }
    return scope?.cell;
  }

  /** `cell`, entry `entry`'s new transient, is seen by the calls nested in this one. */
  share(entry: number, cell: Cell): void {
    this.at = { ...this.at, scope: { entry, cell, next: this.at.scope } };
  }

  /** A future that resolves at `at`, in milliseconds since the Unix epoch, with the others due then. */
  timer(at: bigint): Future {
    const future = new Future();
    const due = this.#timers.get(at);
    if (due === undefined) {
      this.#timers.set(at, [future]);
    } else {
      due.push(future);
    }
    this.arrivals.at(at, () => this.#resolveDue());
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
    } catch (error) {
      this.fail(error);
    } finally {
      this.at = caller;
    }
  }

  #call(entry: number, argumentValues: readonly Value[]): unknown {
    return (this.functions[entry] as LiveFunction)(null, ...argumentValues);
  }

  /** Encodes the root's outcome `value` and ends the run with it. */
  #finish(value: Value): void {
    const root = this.#root ?? unreachable('The run finished before it started.');
    this.#end({ kind: 'finished', encoded: this.#call(root.encoder, [value]) as Value });
  }

  /** Resolves the timers due by the clock, each instant's together, the earliest first. */
  #resolveDue(): void {
    const now = this.seams.clock.now();
    const due = [...this.#timers.keys()]
      .filter((at) => at <= now)
      .toSorted((a, b) => (a < b ? -1 : 1));
    for (const at of due) {
      const futures = this.#timers.get(at) ?? [];
      this.#timers.delete(at);
      this.waits.resolveTogether(futures.map((future) => [future, null] as const));
    }
  }

  #end(end: RunEnd): void {
    this.#stop('ended');
    this.seams.ended(end);
  }

  #stop(why: 'ended' | 'broken'): void {
    this.#stopped = why;
    this.arrivals.stop();
  }
}
