/**
 * The one run (ir-first design, decision 2): one instance's program, its objects and the loop
 * driving its executions, with what compiled code calls (codegen/emit.ts `helpers`).
 *
 * - **Parts.** The run composes what it owns: holders (lifetimes.ts), places (places.ts), value
 *   builders, transients, async calls (executions.ts), the ready queue, timers, arrivals from
 *   outside, calls into the instance (invocations.ts), watches on other instances' ends, weak
 *   references, host values (resources.ts) and rebindable function slots (slots.ts). Compiled code
 *   takes its helpers from the part owning them.
 * - **Calls.** A simple entry is a JavaScript function; an async one runs as an execution of its
 *   own, its caller getting its future.
 * - **The loop.** `drain` runs the ready queue empty, one item at a time in the order readied (§15.1);
 *   `takeArrivals` runs what arrived from outside, a turn at a time, each also told to the world as
 *   an input a segment run again applies again (§14).
 * - **Natives** are bound per extern when the program loads (natives.ts).
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import { startsExecution } from '../../definition/tables/functions.ts';
import type { Definition } from '../../definition/tables/index.ts';
import { disposeOf } from '../../definition/tables/types.ts';
import { type RuntimeValues, valueSemanticsOf } from '../../definition/values/equality.ts';
import type { Value } from '../../definition/values/values.ts';
import { Unreachable } from '../../foundation/structures/unreachable.ts';
import { type HostFilling, stackSite } from '../natives.ts';
import { drawOf } from '../random-draws.ts';
import { type Arrival, Arrivals } from './arrivals.ts';
import { ClosureCalls, directAritiesOf } from './closure-calls.ts';
import { type DisposalSeams, disposerOf } from './disposal.ts';
import { EndWatches, type PendingWatch } from './end-watches.ts';
import { Executions, PARKED, STOP, STOPPED } from './executions.ts';
import type { Instance } from './instances.ts';
import { instantiatorOf } from './instantiation.ts';
import { type Invocation, Invocations, type RunningInvocation } from './invocations.ts';
import { Lifetimes } from './lifetimes.ts';
import { bindNatives, type RunSeams } from './natives.ts';
import type { Execution, Frame } from './objects/execution.ts';
import { Future, watchFuture } from './objects/future.ts';
import type { WeakReference } from './objects/weak-reference.ts';
import { PanicGuard } from './panic-guard.ts';
import { Places } from './places.ts';
import { calledPrimitives } from './primitives.ts';
import { type PersistedReady, type Ready, ReadyQueue } from './ready-queue.ts';
import { Resources } from './resources.ts';
import { Settler, type Settling } from './settling.ts';
import { type Binding, NOT_REBOUND, Slots } from './slots.ts';
import { type Timer, Timers } from './timers.ts';
import { Traces } from './traces.ts';
import { Transients } from './transients.ts';
import { ValueBuilders } from './value-builders.ts';
import { WeakReferences } from './weak-references.ts';
import type { World } from './world.ts';

type Entry = (...parameters: never[]) => unknown;

/** What a run keeps beside its objects, as a snapshot writes it. */
interface PersistedRun {
  readonly serial: number;
  readonly live: readonly Execution[];
  readonly timers: readonly Timer[];
  readonly watches: readonly PendingWatch[];
  readonly invocations: readonly RunningInvocation[];
  readonly ready: readonly PersistedReady[];
  readonly bindings: readonly Binding[];
}

export class Run {
  readonly definition: Definition;
  readonly constants: readonly Value[];
  /** The instance this run is: every execution of it is the instance's. */
  readonly instance: Instance;
  /** The instances beside it, which it reaches only through the world. */
  readonly world: World;
  /** The secret seed of the instance's random source (§19.2 `random`), which its snapshot keeps. */
  readonly seed: Uint8Array;
  /** `==` and maps over the program's values (§19.3, §10.2). */
  readonly values: RuntimeValues;
  readonly lifetimes: Lifetimes;
  readonly places: Places;
  readonly builders: ValueBuilders;
  readonly transients = new Transients(this);
  readonly queue = new ReadyQueue();
  readonly timers = new Timers();
  readonly arrivals = new Arrivals();
  readonly weakReferences = new WeakReferences();
  readonly resources = new Resources();
  readonly invocations: Invocations;
  readonly endWatches: EndWatches;
  readonly executions: Executions;
  readonly slots: Slots;
  readonly traces: Traces;
  /** The calls compiled code makes through a function value of a few arguments. */
  readonly closureCalls: ClosureCalls;
  /** The primitive operations compiled code calls rather than writes inline. */
  readonly primitives = calledPrimitives;
  /** The markers compiled code compares a frame's result and decision with. */
  readonly signals = { parked: PARKED, stopped: STOPPED, stop: STOP, notRebound: NOT_REBOUND };
  /**
   * Told of each turn the run takes as an input its world can apply again, to a run of the same
   * instance read back from a snapshot (a segment run again, §14).
   */
  onArrivalTaken: ((input: (run: Run) => void) => void) | undefined;
  /** The compiled entries, by function index, once its program is instantiated over it. */
  readonly entries: readonly Entry[];
  readonly #directArities: Int16Array;
  readonly #natives: (index: number) => Entry;
  readonly #settler: Settler;
  readonly #guard: PanicGuard;
  #objects = 0;

  constructor(definition: Definition, program: EmittedProgram, seams: RunSeams) {
    this.definition = definition;
    this.constants = definition.constants;
    this.instance = seams.instance;
    this.world = seams.world;
    this.seed = seams.seed;
    this.slots = new Slots(this);
    this.values = valueSemanticsOf(definition.functions);
    this.lifetimes = new Lifetimes(disposerOf(this.#disposal()), definition.types, this.values);
    for (const constant of this.constants) {
      this.lifetimes.share(constant);
    }
    this.places = new Places(this.lifetimes);
    this.builders = new ValueBuilders(this.lifetimes, this.values, () => this.newId());
    this.#settler = new Settler(
      (callback, value) => this.callValue(callback, [value]),
      this.lifetimes,
    );
    this.invocations = new Invocations(this.instance, this.lifetimes);
    this.endWatches = new EndWatches(
      ({ future, instance }) => this.world.watchEnd(this, instance, future),
      (future, value) => this.settle(future, value),
    );
    this.executions = new Executions({
      definition,
      instance: this.instance,
      lifetimes: this.lifetimes,
      queue: this.queue,
      entry: (index) => this.entries[index] as (frame: Frame) => unknown,
      newId: () => this.newId(),
      settle: (future, value) => this.settle(future, value),
      startedTransients: () => this.transients.started(),
      guarded: (run) => this.#guard.guarded(run),
    });
    this.#natives = bindNatives(this, seams);
    this.closureCalls = new ClosureCalls(this, definition);
    this.#directArities = directAritiesOf(definition);
    const { site, entries } = instantiatorOf(program)(this);
    this.entries = entries;
    this.traces = new Traces(definition, program.lines, site);
    this.#guard = new PanicGuard(this.instance, this.traces, () => this.lifetimes.passesPanics);
  }

  /** What disposing this run's objects needs of it (disposal.ts). */
  #disposal(): DisposalSeams {
    return {
      weakReferences: this.weakReferences,
      resources: this.resources,
      disposeOf: (type) => disposeOf(this.definition.types, type),
      runDispose: (index, disposed) =>
        this.lifetimes.apart(() => this.lifetimes.letGo(this.call(index, [disposed]) as Value)),
      passesPanics: () => this.lifetimes.passesPanics,
      callApart: (closure) =>
        this.lifetimes.apart(() => this.lifetimes.letGo(this.callValue(closure, []) as Value)),
      letGo: (...values) => this.lifetimes.letGo(...values),
      stop: (execution) => this.executions.stop(execution),
      settle: (future, value) => this.settle(future, value),
    };
  }

  // What compiled code calls besides its parts' helpers.

  readonly equal = (first: Value, second: Value): boolean => this.values.equal(first, second);
  readonly mapOf = (entries: readonly (readonly [Value, Value])[]): Value =>
    this.values.mapOf(entries);

  /** A new object's identity: newer objects have greater ones. */
  newId(): number {
    this.#objects += 1;
    return this.#objects;
  }

  /** The instance's value of the context constant `name`, once made (§7.1). */
  readonly contextConstant = (name: string): Value | undefined =>
    this.instance.contextConstants.read(name);

  readonly makeContextConstant = (name: string, value: Value): void => {
    this.lifetimes.hold(value);
    this.instance.contextConstants.made(name, value);
  };

  /** Calls the function value `callee` with `passed`, as its entry is called. */
  readonly callValue = (callee: Value, passed: readonly Value[]): unknown => {
    const closure = callee as { readonly function: number };
    return this.call(closure.function, passed, callee);
  };

  /** Calls entry `index` with `passed`, `closure` the function value it runs as. */
  call(index: number, passed: readonly Value[], closure?: Value): unknown {
    const run = this.entries[index] as (...given: unknown[]) => unknown;
    if (this.#directArities[index] === passed.length) {
      return run(...passed, closure);
    }
    const entry = this.definition.functions[index];
    if (entry?.kind === 'code' && startsExecution(entry)) {
      return this.executions.start(index, passed, closure);
    }
    if (entry?.kind !== 'code') {
      return run(...passed);
    }
    // A call leaving parameters out passes them absent, which the prologue computes (§6.1).
    const leftOut = Array.from({ length: entry.parameters.length - passed.length });
    return run(...passed, ...leftOut, closure);
  }

  /** Starts async entry `index`, as compiled code's call of it does. */
  readonly start = (index: number, passed: readonly Value[], closure: Value | undefined): Future =>
    this.executions.start(index, passed, closure);

  readonly unreachableHere = unreachableHere;

  /** The native bound to extern `index`. */
  native(index: number): Entry {
    return this.#natives(index);
  }

  /** The instance's next random draw (§19.2 `random`): a segment run again draws the same ones (§14). */
  draw(): Uint8Array {
    this.instance.draws += 1;
    return drawOf(this.seed, this.instance.draws - 1);
  }

  /** What `run` gives, run as a call of its own outside every execution (executions.ts). */
  asCall<Result>(run: () => Result): Result | undefined {
    return this.executions.asCall(run);
  }

  // Futures.

  /** Settles `future` with `value`, which it holds. */
  settle(future: Future, value: Value): void {
    this.settleTogether([[future, value]]);
  }

  /** Settles futures together as one event, calling what waits on them in its order (§15.2). */
  settleTogether(settling: Settling): void {
    this.#settler.settleTogether(settling);
  }

  /** A future settling at `at`, in milliseconds since the Unix epoch (`time.at`). */
  timer(at: bigint): Future {
    const future = new Future(this.newId());
    this.timers.add({ at, future });
    return future;
  }

  /** Settles every timer due at `now` or before, the earliest instant's together first. */
  fireDue(now: bigint): void {
    for (let at = this.timers.next(); at !== undefined && at <= now; at = this.timers.next()) {
      this.settleTogether(this.timers.takeDue(at).map((future) => [future, null]));
      this.drain();
    }
  }

  /** How a host fills `future`, the pending future of the extern being called here (§17.2). */
  filling(future: Future): HostFilling {
    return this.arrivals.filling(this, future, stackSite("the host extern's call"));
  }

  /** A future settling with how the instance `name` ends (§17.1); a snapshot keeps the watch. */
  watchEnd(name: string): Future {
    const future = new Future(this.newId());
    this.endWatches.watch({ future, instance: name });
    return future;
  }

  /** The future `weak`'s `disposed()` gives (§16): settled once its referent is disposed. */
  disposedOf(weak: WeakReference): Future {
    weak.whenDisposed = watchFuture(weak.whenDisposed, () => new Future(this.newId()));
    if (weak.target === undefined && !weak.whenDisposed.settled) {
      this.settle(weak.whenDisposed, null);
    }
    return weak.whenDisposed;
  }

  // The loop.

  /** Whether nothing is ready to run in it, nor has anything arrived. */
  get idle(): boolean {
    return this.queue.empty && this.arrivals.empty;
  }

  /**
   * Readies `invocation` of `closure` with `passed` in this run's instance; the root one, an
   * instance's spawned call, ends its instance.
   */
  invoke(closure: Value, passed: readonly Value[], invocation: Invocation): void {
    this.queue.invoke(closure, passed, invocation);
  }

  /**
   * Runs what arrived from outside the run, one turn at a time, each draining what it readied;
   * whether there was any.
   */
  takeArrivals(done: () => boolean = () => false, untilParked = false): boolean {
    let took = false;
    for (let next = this.arrivals.next(); next !== undefined; next = this.arrivals.next()) {
      const arrival = next;
      took = true;
      this.onArrivalTaken?.((run) => run.#land({ ...arrival, object: undefined }));
      this.#land(arrival);
      this.drain(done, untilParked);
      if (this.#stopsDraining(done, untilParked)) {
        break;
      }
    }
    return took;
  }

  /** Runs `arrival` here on its object; on nothing when the run made its object again. */
  #land(arrival: Arrival): void {
    const object = this.arrivals.objectOf(arrival);
    if (object !== undefined) {
      arrival.turn(this, object);
    }
  }

  /** Runs the ready queue until it is empty or `done` says the run is done; whether it ran any. */
  drain(done: () => boolean = () => false, untilParked = false): boolean {
    let ran = false;
    for (
      let next = this.#nextToRun(done, untilParked);
      next !== undefined;
      next = this.#nextToRun(done, untilParked)
    ) {
      ran = true;
      if (next.kind === 'resume') {
        this.executions.resume(next.execution, next.decision);
      } else if (next.kind === 'invoke') {
        this.#invoked(next);
      } else {
        const { closure, arguments: passed } = next;
        const result = this.asCall(() => this.callValue(closure, passed)) as Value;
        this.lifetimes.letGo(result, closure, ...passed);
      }
    }
    return ran;
  }

  #stopsDraining(done: () => boolean, untilParked: boolean): boolean {
    return done() || (untilParked && this.executions.parkedSinceCommit);
  }

  /** What runs next unless done; once a call parked, `untilParked`, only a waiting invocation. */
  #nextToRun(done: () => boolean, untilParked: boolean): Ready | undefined {
    if (done()) {
      return undefined;
    }
    const parked = untilParked && this.executions.parkedSinceCommit;
    return parked ? this.queue.nextInvocation() : this.queue.next();
  }

  /**
   * Finishes the run once its outcome is encoded (§16): what is readied never runs, what it was to
   * be called with let go of, every call still suspended stops, and `held` is let go of, the
   * outcome's holder; all together, newest first. Its context constants go last (context-
   * constants.ts), each disposing what it held before the next goes.
   */
  finish(held: readonly Value[]): void {
    const readied = this.queue.dropped();
    this.lifetimes.apart(() => {
      this.lifetimes.letGo(...held, ...readied);
      this.executions.stopAll();
    });
    this.instance.contextConstants.release((value) => this.lifetimes.letGo(value));
  }

  /** Runs an invocation readied by `invoke`, its instance's panic ending it. */
  #invoked({ closure, arguments: passed, invocation }: Extract<Ready, { kind: 'invoke' }>): void {
    const { instance } = this;
    if (instance.end !== undefined) {
      invocation.answer(instance.end);
      return;
    }
    this.invocations.waitOnEnd(invocation);
    const given = this.#guard.guarded(() => this.slots.started(closure, passed));
    if (given instanceof Future) {
      this.invocations.attach(given, invocation);
    } else if (instance.end === undefined) {
      // A plain function's call gives its value at once (§17.1); a panicked one gives none.
      this.invocations.answer(invocation, given as Value);
    }
  }

  // Snapshots.

  /** What a snapshot of this run's instance keeps besides what its objects hold (snapshot/). */
  persisted(): PersistedRun {
    return {
      serial: this.#objects,
      live: this.executions.live,
      timers: this.timers.persisted(),
      watches: this.endWatches.persisted(),
      invocations: this.invocations.persisted(),
      ready: this.queue.persisted(),
      bindings: this.slots.bindings,
    };
  }

  /**
   * Resumes keeping what a snapshot read back kept (snapshot/restore.ts): its objects already made,
   * each holder counted again; its watches asked of the world again.
   */
  restored(state: PersistedRun): void {
    this.#objects = state.serial;
    this.executions.restore(state.live);
    this.timers.restore(state.timers);
    for (const watch of state.watches) {
      this.endWatches.watch(watch);
    }
    for (const { future, invocation } of state.invocations) {
      this.invocations.attach(future, invocation);
    }
    this.queue.restore(state.ready);
    this.slots.restored(state.bindings);
  }
}

/** What compiled code throws where control reaches code no path reaches: a lowering bug. */
function unreachableHere(): Error {
  return new Unreachable('Control reached code no path reaches.');
}
