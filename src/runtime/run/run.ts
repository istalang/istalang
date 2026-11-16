/**
 * The one run (ir-first design, decision 2): what compiled code calls (codegen/emit.ts `helpers`)
 * over one program's code and tables, and the loop driving its executions.
 *
 * - **Values** are the in-memory shapes (definition/values/values.ts) and the run's objects
 *   (objects.ts); holders are kept as lifetimes.ts says, every hold and let-go placed by lowering.
 * - **Calls.** A simple entry is a JavaScript function; an async one runs on its frame record as an
 *   execution of its own, started at once: it runs until it parks or returns, and its caller gets
 *   its future. A returned execution settles its future, readying the callbacks waiting on it.
 * - **The ready queue** holds unparked executions and readied closure calls, run one at a time in
 *   the order they were readied (§6): `drain` runs it empty.
 * - **Natives** are bound per extern when the program loads (natives.ts): each takes its arguments
 *   as values, and its result is held by the register it lands in.
 * - A panic is a thrown `Panic`, or a host limit `panicOf` names; its trace is read off the stack.
 */

import type { EmittedProgram } from '../../codegen/emit.ts';
import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import type { TypeReference } from '../../definition/tables/types.ts';
import { disposeOf, lifetimeOf } from '../../definition/tables/types.ts';
import { mapOf, valuesEqual } from '../../definition/values/equality.ts';
import { copied } from '../../definition/values/replacing.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { type HostFilling, panicOf } from '../natives.ts';
import { drawOf } from '../random-draws.ts';
import {
  type Instance,
  type InstanceEnd,
  type InvocationEnd,
  instanceEnding,
} from './instances.ts';
import { Lifetimes } from './lifetimes.ts';
import { answerOfMock } from './mock-answers.ts';
import { Mocks } from './mocks.ts';
import { bindNatives, type NativeBinding } from './natives.ts';
import {
  Cell,
  Execution,
  type Frame,
  Future,
  MockObject,
  Reference,
  Resource,
  type RunObject,
  type Step,
  WeakReference,
} from './objects.ts';
import * as primitives from './primitives.ts';
import { runNatives } from './run-natives.ts';
import { Traces } from './traces.ts';
import type { World } from './world.ts';

/**
 * A turn arriving from outside the run (`Run.arrive`): what it does to the object it concerns, in the
 * run it lands in, and its place among every run's arrivals.
 */
interface Arrival {
  /** The object, in the run it arrived at; undefined once it moved on, its id naming it there. */
  readonly object: RunObject | undefined;
  readonly id: number;
  readonly turn: (run: Run, object: RunObject) => void;
  readonly order: number;
}

/** What a parked frame's resumable function returns. */
const PARKED = Symbol('parked');
/** What a stopped frame's resumable function returns. */
const STOPPED = Symbol('stopped');
/** The decision a stopped frame resumes with, which sends it to its stop landing. */
const STOP = Symbol('stop');
/** What `mocked` gives where no mock holds. */
const NOT_MOCKED = Symbol('not mocked');

type Entry = (...parameters: never[]) => unknown;

/** Something readied to run: an execution unparked with its decision, or a closure's call. */
type Ready =
  | { readonly kind: 'resume'; readonly execution: Execution; readonly decision: unknown }
  | { readonly kind: 'call'; readonly closure: Value; readonly arguments: readonly Value[] }
  | {
      readonly kind: 'invoke';
      readonly closure: Value;
      readonly arguments: readonly Value[];
      readonly invocation: Invocation;
    };

/**
 * An invocation's answer: told how the call into the instance ended. The root one, an instance's
 * spawned call, ends its instance, which a snapshot keeps, so reading it back answers it again.
 */
export interface Invocation {
  readonly answer: (end: InvocationEnd) => void;
  readonly root: boolean;
}

/** What a run keeps beside its objects, as a snapshot writes it. */
export interface PersistedRun {
  readonly serial: number;
  readonly live: readonly Execution[];
  readonly timers: readonly { readonly at: bigint; readonly future: Future }[];
  readonly watches: readonly { readonly future: Future; readonly instance: string }[];
  readonly invocations: readonly { readonly future: Future; readonly invocation: Invocation }[];
  /** What is ready to run as it commits, in order: resumes of parked calls and readied callbacks. */
  readonly ready: readonly (
    | { readonly execution: Execution; readonly decision: Value }
    | { readonly call: Value; readonly arguments: readonly Value[] }
  )[];
}

export class Run {
  readonly definition: Definition;
  readonly constants: readonly Value[];
  readonly lifetimes: Lifetimes;
  readonly #entries: readonly Entry[];
  readonly #traces: Traces;
  readonly #natives: (index: number) => Entry;
  readonly #ready: Ready[] = [];
  /** The executions started and not yet ended. */
  readonly #live = new Set<Execution>();
  /** The execution whose call is being disposed now, its `disposing()` future settling. */
  #disposingNow: Execution | undefined;
  /**
   * The futures settling with how another instance ends (§9): the instance each watches, and the
   * `Result` entry it answers with.
   */
  readonly #watches = new Map<Future, string>();
  #objects = 0;
  /** The transients shared now, by `function:register`, innermost last (§3.4). */
  readonly #transients = new Map<string, Cell[]>();
  readonly #weakReferences = new WeakMap<RunObject, WeakReference>();
  #timers: { readonly at: bigint; readonly future: Future }[] = [];
  readonly #arrivals: Arrival[] = [];
  /** How many turns arrived at any run, which orders arrivals across runs (`firstArrival`). */
  static #arrived = 0;
  /** The run its instance goes on in, once a segment run again replaced this one (`succeededBy`). */
  #successor: Run | undefined;
  /** The objects a snapshot read back made, by id, which a turn arriving from another run acts on. */
  #restoredObjects: ReadonlyMap<number, RunObject> = new Map();
  /**
   * Told of each turn the run takes as an input its world can apply again, to a run of the same
   * instance read back from a snapshot (a segment run again, §5).
   */
  onArrivalTaken: ((input: (run: Run) => void) => void) | undefined;
  #wake: (() => void) | undefined;
  /** How many host fillings are still pending. */
  #hostWork = 0;
  /** The execution running now, whose code a native or `currentCall` reads. */
  #running: Execution | undefined;
  /** The instance this run is: every execution of it is the instance's. */
  readonly instance: Instance;
  /** The instances beside it, which it reaches only through the world. */
  readonly world: World;
  /** The secret seed of the instance's random source (§3.8 `random`), which its snapshot keeps. */
  readonly seed: Uint8Array;
  /** The mocks the instance holds, in a Definition built to run tests (§10). */
  readonly mocks = new Mocks();
  /** The host values this instance holds, by their payloads, each one object while held. */
  readonly #resources = new Map<unknown, Resource>();
  /**
   * The entry an invocation starts with while it starts: a mock replaces calls of its target, never
   * the function an instance or a context's call starts with (§10).
   */
  #starting: number | undefined;
  /** What the listeners of the futures settling now settle, together once they all have. */
  #following: (readonly [Future, Value])[] | undefined;

  constructor(definition: Definition, program: EmittedProgram, binding: NativeBinding) {
    this.definition = definition;
    this.instance = binding.instance;
    this.world = binding.world;
    this.seed = binding.seed;
    this.lifetimes = new Lifetimes((object) => this.#disposed(object), definition.types);
    this.constants = definition.constants;
    for (const constant of this.constants) {
      this.lifetimes.share(constant);
    }
    this.#natives = bindNatives(this, {
      ...binding,
      natives: { ...binding.natives, ...runNatives(this) },
    });
    const made = new Function('rt', program.body) as (rt: Run) => {
      readonly site: Error;
      readonly entries: readonly Entry[];
    };
    const { site, entries } = made(this);
    this.#entries = entries;
    this.#traces = new Traces(definition, program.lines, site);
  }

  // What compiled code calls.

  readonly hold = (value: Value | undefined): void => this.lifetimes.hold(value);
  readonly share = (value: Value | undefined): void => this.lifetimes.share(value);
  readonly letGo = (...values: (Value | undefined)[]): void => this.lifetimes.letGo(...values);
  readonly equal = valuesEqual;
  readonly mapOf = (entries: readonly (readonly [Value, Value])[]): Value => mapOf(entries);
  readonly PARKED = PARKED;
  readonly STOPPED = STOPPED;
  readonly STOP = STOP;
  readonly NOT_MOCKED = NOT_MOCKED;
  readonly floorDivide = primitives.floorDivide;
  readonly remainder = primitives.remainder;
  readonly intPower = primitives.intPower;
  readonly shiftLeft = primitives.shiftLeft;
  readonly shiftRight = primitives.shiftRight;
  readonly floatCompare = primitives.floatCompare;
  readonly intFromFloat = primitives.intFromFloat;

  /** A new object's identity: newer objects have greater ones. */
  newId(): number {
    this.#objects += 1;
    return this.#objects;
  }

  /** The items of the array `value`, each held again when `counted`, as a spread copies them. */
  readonly items = (value: Value, counted: boolean): readonly Value[] => {
    const { elements } = value as { readonly elements: readonly Value[] };
    this.#keptAgain(elements, counted);
    return elements;
  };

  /** The entries of the map `value`, keys and values held again when `counted`. */
  readonly entries = (value: Value, counted: boolean): readonly (readonly [Value, Value])[] => {
    const { entries } = value as { readonly entries: readonly (readonly [Value, Value])[] };
    this.#keptAgain(entries.flat(), counted);
    return entries;
  };

  #keptAgain(values: readonly Value[], counted: boolean): void {
    for (const value of values) {
      if (counted) {
        this.lifetimes.hold(value);
      } else {
        this.lifetimes.share(value);
      }
    }
  }

  /**
   * A new cell holding `value`, held by the register it lands in when `counted`; a shared struct's
   * runs entry `dispose` as it is let go of.
   */
  readonly cell = (value: Value, counted: boolean, dispose?: number): Cell => {
    const made = new Cell(this.newId(), value, counted, dispose);
    made.count = counted ? 1 : 0;
    return made;
  };

  /** The one weak reference to `target` (§7), made the first time it is asked for. */
  weakReference(target: RunObject): WeakReference {
    const known = this.#weakReferences.get(target);
    if (known !== undefined) {
      return known;
    }
    const made = new WeakReference(this.newId(), target);
    this.#weakReferences.set(target, made);
    return made;
  }

  /** The value at `path` in the place a root of `kind` in `root` reaches. */
  readonly load = (
    kind: 'register' | 'cell' | 'reference',
    root: Value,
    path: readonly Step[],
  ): Value => {
    let value = this.#rootValue(kind, root);
    for (const [part, position] of path) {
      value = ((value as unknown as Record<string, Value[]>)[part] ?? [])[position] ?? null;
    }
    return value;
  };

  /**
   * Moves `value` into the place at `path` of a root of `kind`, changing each value along it in
   * place where unique; for a register's root, the root's new value.
   */
  readonly store = (
    kind: 'register' | 'cell' | 'reference',
    root: Value,
    path: readonly Step[],
    value: Value,
    counted: boolean,
  ): Value | undefined => {
    if (kind === 'register') {
      return this.lifetimes.withPart(root, path, value, counted);
    }
    const { cell, steps } = this.#placeOf(kind, root, path);
    cell.value = this.lifetimes.withPart(cell.value, steps, value, counted);
    return undefined;
  };

  /** A reference to the place at `path` of a root of `kind`, a cell or another reference. */
  readonly reference = (
    kind: 'register' | 'cell' | 'reference',
    root: Value,
    path: readonly Step[],
  ): Reference => {
    const { cell, steps } = this.#placeOf(kind, root, path);
    return new Reference(cell, steps);
  };

  #placeOf(
    kind: 'register' | 'cell' | 'reference',
    root: Value,
    path: readonly Step[],
  ): { readonly cell: Cell; readonly steps: readonly Step[] } {
    if (kind === 'cell') {
      return { cell: root as unknown as Cell, steps: path };
    }
    if (kind === 'reference') {
      const reference = root as unknown as Reference;
      return { cell: reference.cell, steps: [...reference.path, ...path] };
    }
    throw new Error('A place rooted at a register has no cell to refer into.');
  }

  #rootValue(kind: 'register' | 'cell' | 'reference', root: Value): Value {
    switch (kind) {
      case 'register':
        return root;
      case 'cell':
        return (root as unknown as Cell).value;
      case 'reference': {
        const { cell, path } = root as unknown as Reference;
        return this.load('cell', cell as unknown as Value, path);
      }
      default:
        return root;
    }
  }

  /** The value at a reference's place, as a native taking it by `&` reads it. */
  deref(reference: Reference): Value {
    return this.load('cell', reference.cell as unknown as Value, reference.path);
  }

  /** The transient cell shared by the nearest call nesting this one of its function (§3.4). */
  readonly transient = (key: string): Cell | undefined => this.#transients.get(key)?.at(-1);

  readonly shareTransient = (key: string, cell: Cell): void => {
    const shared = this.#transients.get(key) ?? [];
    shared.push(cell);
    this.#transients.set(key, shared);
  };

  readonly unshareTransient = (key: string, cell: Cell | undefined): void => {
    const shared = this.#transients.get(key);
    if (cell !== undefined && shared?.at(-1) === cell) {
      shared.pop();
    }
  };

  /** The instance's value of the context constant `name`, once made (§3.4). */
  readonly contextConstant = (name: string): Value | undefined =>
    this.instance.contextConstants.get(name);

  readonly makeContextConstant = (name: string, value: Value): void => {
    this.lifetimes.hold(value);
    this.instance.contextConstants.set(name, value);
  };

  /**
   * Readies an invocation of `closure` in this run's instance: its function run as an execution of
   * it, `answer` told what it gave, or the instance's end if it panicked or had ended.
   */
  invoke(
    closure: Value,
    answer: (end: InvocationEnd) => void,
    { root = false, passed = [] }: { readonly root?: boolean; readonly passed?: readonly Value[] } = {},
  ): void {
    this.#ready.push({ kind: 'invoke', closure, arguments: passed, invocation: { answer, root } });
  }

  /** Calls the function value `callee` with `passed`, as its entry is called. */
  readonly callValue = (callee: Value, passed: readonly Value[]): unknown => {
    const closure = callee as { readonly function: number };
    return this.call(closure.function, passed, callee);
  };

  /** Calls entry `index` with `passed`, `closure` the function value it runs as. */
  call(index: number, passed: readonly Value[], closure?: Value): unknown {
    const entry = this.definition.functions[index];
    if (entry?.kind === 'code' && entry.mode !== 'simple') {
      return this.start(index, passed, closure);
    }
    const run = this.#entries[index] as (...given: unknown[]) => unknown;
    if (entry?.kind !== 'code') {
      return run(...passed);
    }
    // A call leaving parameters out passes them absent, which the prologue computes (§3.3).
    const leftOut = Array.from({ length: entry.parameters.length - passed.length });
    return run(...passed, ...leftOut, closure);
  }

  /**
   * Starts async entry `index` with `passed`: runs it until it parks or returns; its future. Its
   * frame outlives the caller's step, so it holds what it was given until it ends.
   */
  readonly start = (
    index: number,
    passed: readonly Value[],
    closure: Value | undefined,
  ): Future => {
    const entry = this.definition.functions[index] as CodeFunction;
    const execution = new Execution(this.newId(), this.newId(), this.instance);
    passed.forEach((value, at) => {
      const type = entry.registers[at]?.type;
      if (type !== undefined) {
        this.lifetimes.keep(value, type);
      }
    });
    this.lifetimes.hold(closure);
    execution.given = [...passed, closure ?? null];
    this.#live.add(execution);
    const registers: (Value | undefined)[] = Array.from({ length: entry.registers.length });
    passed.forEach((value, at) => {
      registers[at] = value;
    });
    const captures = (closure as { readonly captures?: readonly Value[] } | undefined)?.captures;
    captures?.forEach((value, at) => {
      registers[entry.parameters.length + at] = value;
    });
    execution.frame = {
      function: index,
      pc: 0,
      registers,
      closure,
      decision: undefined,
      execution,
      stopping: false,
    };
    const { future } = execution;
    future.count = 1;
    this.#resume(execution, undefined);
    return future;
  };

  /**
   * What the mock the call of entry `index` with `passed` reaches answers, held here or by an
   * instance this one was spawned from (§10); `NOT_MOCKED` where none is held.
   */
  readonly mocked = (index: number, passed: readonly Value[]): unknown => {
    if (this.#starting === index) {
      this.#starting = undefined;
      return NOT_MOCKED;
    }
    const mock = this.mocks.of(index);
    const held = mock === undefined ? this.world.heldMock?.(this, index) : { holder: this, mock };
    return held === undefined
      ? NOT_MOCKED
      : answerOfMock(this, held, passed, this.#resultType(index));
  };

  /** What entry `index` gives: an extern's result, or what a mock of a code entry answers. */
  #resultType(index: number): TypeReference {
    const entry = this.definition.functions[index];
    if (entry?.kind === 'extern') {
      return entry.result;
    }
    const mocked = entry?.instructions.find((each) => each.kind === 'mocked');
    const type = mocked === undefined ? undefined : entry?.registers[mocked.dst]?.type;
    return type ?? unreachable(`Entry ${String(index)} answers no mock.`);
  }

  /** Records the call of `mock`'s target with `passed`, then runs its replacement with them. */
  answer(mock: MockObject, passed: readonly Value[]): unknown {
    const entry = this.definition.functions[mock.target];
    const types =
      entry?.kind === 'code'
        ? entry.registers.slice(0, entry.parameters.length).map(({ type }) => type)
        : (entry?.parameters.map(({ type }) => type) ?? []);
    // A call of a function of none is a `Unit`, the empty tuple's one value (§10 `calls()`).
    const call: Value = passed.length === 0 ? null : { kind: 'tuple', elements: [...passed] };
    this.lifetimes.adopt(call, { kind: 'tuple', elements: types });
    mock.calls.push(call);
    return this.callValue(mock.replacement, passed);
  }

  /**
   * The host value of the extern type entry `type` holding `payload`, which this instance got from
   * a call and so owns (§7, §9): one object per payload while it is held, so it compares equal to
   * itself as it comes back.
   */
  resource(type: number, payload: unknown): Resource {
    const known = this.#resources.get(payload);
    if (known !== undefined) {
      return known;
    }
    const made = new Resource(this.newId(), type, payload);
    this.#resources.set(payload, made);
    return made;
  }

  /** Holds `mock`, read back from a snapshot, as it was held when written. */
  restoredMock(mock: MockObject): void {
    this.mocks.hold(mock);
  }

  /** Knows `resource`, read back from a snapshot, as the one host value for its payload. */
  restoredResource(resource: Resource): void {
    if (!resource.disposed) {
      this.#resources.set(resource.payload, resource);
    }
  }

  /** Holds a mock replacing entry `target` with `replacement` (§10); its handle. */
  mock(target: number, replacement: Value): MockObject {
    const mock = new MockObject(this.newId(), target, replacement);
    this.lifetimes.hold(replacement);
    this.mocks.hold(mock);
    return mock;
  }

  readonly unreachableHere = (): Error => new Error('Control reached code no path reaches.');

  /** The instance's next random draw (§3.8 `random`): a segment run again draws the same ones (§5). */
  draw(): Uint8Array {
    this.instance.draws += 1;
    return drawOf(this.seed, this.instance.draws - 1);
  }

  /** The native bound to extern `index`. */
  native(index: number): Entry {
    return this.#natives(index);
  }

  /** Whether register values of `type` are counted, as natives' results are held. */
  isCounted(type: Parameters<typeof lifetimeOf>[1]): boolean {
    return lifetimeOf(this.definition.types, type) === 'counted';
  }

  // Executions and the ready queue.

  /** The execution running now. */
  get running(): Execution | undefined {
    return this.#running;
  }

  /** The execution whose code runs now, as simple code nested in it reads its call (§7). */
  readonly currentExecution = (): Execution | undefined => this.#running;

  /**
   * What `run` gives, run as a call of its own: code the run calls outside every execution (a
   * readied callback, another instance's mock answered here) still has a call, which a wait it
   * makes names (`currentCall`), though it never parks. Its panic ends an ista instance, which
   * gives nothing.
   */
  asCall<Result>(run: () => Result): Result | undefined {
    const outer = this.#running;
    this.#running = new Execution(this.newId(), this.newId(), this.instance);
    try {
      return this.#guarded(run);
    } finally {
      this.#running = outer;
    }
  }

  /**
   * Readies `execution` to resume with `decision`, the position its wait was decided for: decided
   * anew as its call is disposed (`disposingWins`), it resumes where it was readied first.
   */
  unpark(execution: Execution, decision: Value): void {
    if (this.#disposingNow === execution) {
      execution.decidedDisposing = decision;
    }
    const at = this.#ready.findIndex(
      (ready) => ready.kind === 'resume' && ready.execution === execution,
    );
    if (at < 0) {
      this.#ready.push({ kind: 'resume', execution, decision });
    } else {
      this.#ready[at] = { kind: 'resume', execution, decision };
    }
  }

  /** Whether `execution`'s call is being disposed, its `disposing()` future settling (§7). */
  disposingWins(execution: Execution): boolean {
    return this.#disposingNow === execution;
  }

  /** The resume `unpark` readied for `execution`, taken back out of the ready queue. */
  #unready(execution: Execution): Ready | undefined {
    const at = this.#ready.findIndex(
      (ready) => ready.kind === 'resume' && ready.execution === execution,
    );
    return at < 0 ? undefined : this.#ready.splice(at, 1)[0];
  }

  /** Takes back the resume readied for `execution`, which goes on without parking. */
  stayRunning(execution: Execution): void {
    this.#unready(execution);
  }

  /**
   * A future settling with how the instance `name` ends, as `answer` says (§9): the world tells it,
   * and a snapshot keeps the watch.
   */
  watchEnd(name: string): Future {
    const future = new Future(this.newId());
    this.#watch(future, name);
    return future;
  }

  #watch(future: Future, instance: string): void {
    this.#watches.set(future, instance);
    this.world.watchEnd(this, instance, future);
  }

  /** Settles `future`, a watch on another instance's end, with how it ended (§9). */
  endWatched(future: Future, end: InstanceEnd): void {
    this.#watches.delete(future);
    this.settle(future, instanceEnding(end));
  }

  /** What a snapshot of this run's instance keeps besides what its objects hold (snapshot/). */
  persisted(): PersistedRun {
    return {
      serial: this.#objects,
      live: [...this.#live],
      timers: [...this.#timers],
      watches: [...this.#watches].map(([future, instance]) => ({ future, instance })),
      invocations: [...this.#invocations].map(([future, invocation]) => ({ future, invocation })),
      ready: this.#ready.flatMap((ready): PersistedRun['ready'] => {
        switch (ready.kind) {
          case 'resume':
            return [{ execution: ready.execution, decision: ready.decision as Value }];
          case 'call':
            return [{ call: ready.closure, arguments: ready.arguments }];
          default:
            return [];
        }
      }),
    };
  }

  /**
   * Resumes keeping what a snapshot read back kept (snapshot/restore.ts): its objects already made,
   * each holder counted again; its watches asked of the world again.
   */
  restored(state: PersistedRun): void {
    this.#objects = state.serial;
    for (const execution of state.live) {
      this.#live.add(execution);
    }
    this.#timers = [...state.timers];
    for (const { future, instance } of state.watches) {
      this.#watch(future, instance);
    }
    for (const { future, invocation } of state.invocations) {
      this.attachInvocation(future, invocation);
    }
    for (const ready of state.ready) {
      this.#ready.push(
        'execution' in ready
          ? { kind: 'resume', execution: ready.execution, decision: ready.decision }
          : { kind: 'call', closure: ready.call, arguments: ready.arguments },
      );
    }
  }

  /** Whether an invocation waits to start: one a snapshot can't keep, its answer being the caller's. */
  get invoking(): boolean {
    return this.#ready.some((ready) => ready.kind === 'invoke');
  }

  /** Remembers `weak` as the one weak reference to its target, as a snapshot read back gives it. */
  restoredWeakReference(weak: WeakReference): void {
    if (weak.target !== undefined) {
      this.#weakReferences.set(weak.target, weak);
    }
  }

  /** Whether an execution parked since the instance last committed: each await commits (§6). */
  parkedSinceCommit = false;
  /** The execution that parked last, whose await a commit that fails names. */
  lastParked: Execution | undefined;

  /** The invocations still running, by the future of the call each started. */
  readonly #invocations = new Map<Future, Invocation>();

  /** Whether nothing is ready to run in it, nor has anything arrived. */
  get idle(): boolean {
    return this.#ready.length === 0 && this.#arrivals.length === 0;
  }

  /** Readies a call of `closure` with `passed`. */
  enqueue(closure: Value, passed: readonly Value[]): void {
    this.#ready.push({ kind: 'call', closure, arguments: passed });
  }

  /** Settles `future` with `value`, which it holds, as `settleTogether` does. */
  settle(future: Future, value: Value): void {
    this.settleTogether([[future, value]]);
  }

  /**
   * Settles each future with its value, which it holds, calling every callback waiting on any of
   * them at once, in the settle order (spec §8): by rank, then as they were added. What its
   * listeners settle in the run settles together after them, as futures following these do (a
   * mock's answer, mock-answers.ts).
   */
  settleTogether(settling: readonly (readonly [Future, Value])[]): void {
    if (this.#following !== undefined) {
      this.#following.push(...settling);
      return;
    }
    const waiting: {
      readonly callback: Value;
      readonly rank: readonly bigint[];
      readonly value: Value;
    }[] = [];
    for (const [future, value] of settling) {
      if (future.settled) {
        continue;
      }
      future.settled = true;
      future.value = value;
      for (const { callback, rank, standing } of future.callbacks.splice(0)) {
        waiting.push({ callback, rank, value });
        this.lifetimes.letGo(standing);
      }
      this.lifetimes.letGo(...future.onAwaited.splice(0));
    }
    const ordered = waiting.toSorted((first, second) => compareRanks(first.rank, second.rank));
    for (const { callback, value } of ordered) {
      const result = this.callValue(callback, [value]);
      this.lifetimes.letGo(result as Value);
      this.lifetimes.letGo(callback);
    }
    const following: (readonly [Future, Value])[] = [];
    this.#following = following;
    try {
      for (const [future, value] of settling) {
        for (const listener of future.listeners.splice(0)) {
          listener(value);
        }
      }
    } finally {
      this.#following = undefined;
    }
    if (following.length > 0) {
      this.settleTogether(following);
    }
  }

  /** A future settling at `at`, in milliseconds since the Unix epoch (`time.at`). */
  timer(at: bigint): Future {
    const future = new Future(this.newId());
    this.#timers.push({ at, future });
    return future;
  }

  /** When the earliest timer still pending comes due; undefined with none. */
  nextTimer(): bigint | undefined {
    let earliest: bigint | undefined;
    for (const { at, future } of this.#timers) {
      if (!future.settled && future.count > 0 && (earliest === undefined || at < earliest)) {
        earliest = at;
      }
    }
    return earliest;
  }

  /** Settles every timer due at `now` or before, the earliest instant's together first. */
  fireDue(now: bigint): void {
    for (let at = this.nextTimer(); at !== undefined && at <= now; at = this.nextTimer()) {
      const due = this.#timers.filter((timer) => timer.at === at && !timer.future.settled);
      this.#timers = this.#timers.filter((timer) => !due.includes(timer));
      this.settleTogether(due.map(({ future }) => [future, null]));
      this.drain();
    }
  }

  /** How a host fills `future`, its extern's pending future (§9), each fill an arrival. */
  filling(future: Future): HostFilling {
    let state: 'pending' | 'resolved' | 'cancelled' = 'pending';
    this.#hostWork += 1;
    const done = () => {
      this.#hostWork -= 1;
    };
    future.cancels.push(() => {
      if (state === 'pending') {
        state = 'cancelled';
        done();
      }
    });
    return {
      fill: (value) => {
        if (state !== 'pending') {
          return false;
        }
        state = 'resolved';
        this.arrive(future, (run, filled) => {
          if (run === this) {
            done();
          }
          const held = copied(value);
          run.lifetimes.hold(held);
          run.settle(filled, held);
        });
        return true;
      },
      fail: (panic) => {
        state = 'resolved';
        this.arrive(future, (run) => {
          if (run === this) {
            done();
          }
          throw panic;
        });
      },
      onCancel: (callback) => {
        future.cancels.push(callback);
      },
      state: () => state,
    };
  }

  /** Whether a host still owes the run something it waits on. */
  get awaitsHost(): boolean {
    return this.#hostWork > 0;
  }

  /**
   * Readies `turn`, arriving from outside the run, and wakes what waits for an arrival. It acts on
   * `object` in the run it lands in: this one, or one its instance goes on in (`succeededBy`), in
   * which it acts on the object of the same id.
   */
  arrive<Target extends RunObject>(object: Target, turn: (run: Run, object: Target) => void): void {
    this.#queue({
      object,
      id: object.object,
      turn: turn as Arrival['turn'],
      order: Run.#arrived,
    });
    Run.#arrived += 1;
  }

  #queue(arrival: Arrival): void {
    if (this.#successor !== undefined) {
      this.#successor.#queue({ ...arrival, object: undefined });
      return;
    }
    this.#arrivals.push(arrival);
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  /**
   * Hands the instance on to `next`, a run of it read back from a snapshot (§5): what arrived and
   * hasn't run, and all that arrives from now on, lands there.
   */
  succeededBy(next: Run): void {
    this.#successor = next;
    for (const arrival of this.#arrivals.splice(0)) {
      next.#queue({ ...arrival, object: undefined });
    }
  }

  /** Knows the objects a snapshot read back made, by id (snapshot/restore.ts). */
  restoredObjects(objects: ReadonlyMap<number, RunObject>): void {
    this.#restoredObjects = objects;
  }

  /**
   * Runs `arrival` here, on its object, or on the object of its id a snapshot read back made; on
   * nothing when there is none, an object this run made again, whose maker gives it its own.
   */
  #land(arrival: Arrival): void {
    const object = arrival.object ?? this.#restoredObjects.get(arrival.id);
    if (object !== undefined) {
      arrival.turn(this, object);
    }
  }

  /**
   * Where the oldest turn waiting to run arrived among every run's arrivals, so a world runs runs
   * in the order their turns arrived; undefined with none waiting.
   */
  get firstArrival(): number | undefined {
    return this.#arrivals[0]?.order;
  }

  /** Settles once something arrives from outside the run, at once if something has. */
  arrival(): Promise<void> {
    return this.#arrivals.length > 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          this.#wake = resolve;
        });
  }

  /**
   * Runs what arrived from outside the run, one turn at a time, each draining what it readied;
   * whether there was any.
   */
  takeArrivals(done: () => boolean = () => false, untilParked = false): boolean {
    let took = false;
    for (let next = this.#arrivals.shift(); next !== undefined; next = this.#arrivals.shift()) {
      const arrival = next;
      took = true;
      this.onArrivalTaken?.((run) => run.#land({ ...arrival, object: undefined }));
      this.#land(arrival);
      this.drain(done, untilParked);
      if (done() || (untilParked && this.parkedSinceCommit)) {
        break;
      }
    }
    return took;
  }

  /**
   * Runs the ready queue until it is empty, or until `done` says the run is done; whether it ran
   * anything.
   */
  drain(done: () => boolean = () => false, untilParked = false): boolean {
    let ran = false;
    while (!(done() || (untilParked && this.parkedSinceCommit))) {
      const next = this.#ready.shift();
      if (next === undefined) {
        break;
      }
      ran = true;
      if (next.kind === 'resume') {
        this.#resume(next.execution, next.decision);
      } else if (next.kind === 'invoke') {
        this.#invoked(next);
      } else {
        const result = this.asCall(() => this.callValue(next.closure, next.arguments));
        this.lifetimes.letGo(result as Value, next.closure, ...next.arguments);
      }
    }
    return ran;
  }

  /**
   * Finishes the run once its outcome is encoded (§7): what is readied never runs, what it was to
   * be called with let go of, every call still suspended stops, and `held` is let go of, the
   * outcome's holder; all together, newest first.
   */
  finish(held: readonly Value[]): void {
    const readied = this.#ready
      .splice(0)
      .flatMap((ready) => (ready.kind === 'call' ? [ready.closure, ...ready.arguments] : []));
    this.lifetimes.apart(() => {
      this.lifetimes.letGo(...held, ...readied);
      const suspended = [...this.#live].sort((first, second) => second.object - first.object);
      for (const execution of suspended) {
        this.#stop(execution);
      }
    });
  }

  /** Runs an invocation readied by `invoke`, its instance's panic ending it. */
  #invoked({ closure, arguments: passed, invocation }: Extract<Ready, { kind: 'invoke' }>): void {
    const { instance } = this;
    if (instance.end !== undefined) {
      invocation.answer(instance.end);
      return;
    }
    if (!invocation.root) {
      instance.endWatchers.push(invocation.answer);
    }
    const given = this.#guarded(() => this.#started(closure, passed));
    if (given instanceof Future) {
      this.attachInvocation(given, invocation);
    } else if (instance.end === undefined) {
      // A plain function's call gives its value at once (§9).
      this.#answered(invocation, given as Value);
    }
  }

  /**
   * What `closure`'s function gives, started as an invocation: a mock replaces calls of its target,
   * never the function an instance or a context's call starts with (§10).
   */
  #started(closure: Value, passed: readonly Value[]): unknown {
    this.#starting = (closure as { readonly function: number }).function;
    try {
      return this.callValue(closure, passed);
    } finally {
      this.#starting = undefined;
    }
  }

  /** Tells `invocation` its call returned `value`, no longer waiting on the instance's end. */
  #answered(invocation: Invocation, value: Value): void {
    const at = this.instance.endWatchers.indexOf(invocation.answer);
    if (at >= 0) {
      this.instance.endWatchers.splice(at, 1);
    }
    invocation.answer({ kind: 'returned', value });
  }

  /** Answers `invocation` as `future`, its call's, settles, or as the instance ends first. */
  attachInvocation(future: Future, invocation: Invocation): void {
    const { instance } = this;
    if (!(invocation.root || instance.endWatchers.includes(invocation.answer))) {
      instance.endWatchers.push(invocation.answer);
    }
    const returned = (value: Value) => {
      this.#invocations.delete(future);
      this.#answered(invocation, value);
    };
    if (future.settled) {
      returned(future.value);
    } else {
      this.#invocations.set(future, invocation);
      future.listeners.push(returned);
    }
  }

  /** What `run` gives; an ista instance's panic ends it, the live run's propagates to the host. */
  #guarded<Result>(run: () => Result): Result | undefined {
    if (!this.instance.durable) {
      return run();
    }
    try {
      return run();
    } catch (error) {
      const { message, trace } = this.panicOf(error);
      this.instance.ended({ kind: 'panicked', message, trace });
      return undefined;
    }
  }

  #resume(execution: Execution, decision: unknown): void {
    if (execution.ended || this.instance.end !== undefined) {
      return;
    }
    const outer = this.#running;
    this.#running = execution;
    const { frame } = execution;
    frame.decision = decision as Value;
    execution.parked = false;
    try {
      const result = this.#guarded(() =>
        (this.#entries[frame.function] as (given: Frame) => unknown)(frame),
      );
      if (result === PARKED) {
        execution.parked = true;
        this.parkedSinceCommit = true;
        this.lastParked = execution;
        return;
      }
      execution.ended = true;
      this.#live.delete(execution);
      this.lifetimes.letGo(...execution.given);
      if (result === STOPPED || result === undefined) {
        return;
      }
      // A call stopping as it is disposed returns into no future: what it returns is let go of.
      if (execution.frame.stopping) {
        this.lifetimes.letGo(result as Value);
      } else {
        this.settle(execution.future, result as Value);
      }
    } finally {
      this.#running = outer;
    }
  }

  /**
   * The future `weak`'s `disposed()` gives (§7): settled once its referent is disposed, at once if
   * it was already; waiting on it holds nothing.
   */
  disposedOf(weak: WeakReference): Future {
    weak.disposed ??= new Future(this.newId());
    if (weak.target === undefined && !weak.disposed.settled) {
      this.settle(weak.disposed, null);
    }
    return weak.disposed;
  }

  /** The future `execution`'s `disposing()` gives (§7): settled once its call is disposed. */
  disposingOf(execution: Execution): Future {
    execution.disposing ??= new Future(this.newId());
    if (execution.frame.stopping && !execution.disposing.settled) {
      this.settle(execution.disposing, null);
    }
    return execution.disposing;
  }

  /**
   * Stops `execution`, whose future was disposed (§7): its `disposing()` settles, and where that
   * unparks it, it resumes at once, before anything else; else it stops where it waits, its stop
   * landing letting go of what its frame holds. Either way, the next `park` it reaches stops it.
   */
  #stop(execution: Execution): void {
    if (execution.ended) {
      return;
    }
    execution.frame.stopping = true;
    this.lifetimes.apart(() => {
      if (execution.disposing !== undefined) {
        const outer = this.#disposingNow;
        this.#disposingNow = execution;
        try {
          this.settle(execution.disposing, null);
        } finally {
          this.#disposingNow = outer;
        }
      }
      // It resumes on its `disposing()` case, if it waits on one; else it stops where it waits,
      // whatever else decided its wait (§7).
      if (execution.parked) {
        this.#unready(execution);
        this.#resume(execution, execution.decidedDisposing ?? STOP);
      }
    });
  }

  /** What disposing `object`, which lost its last holder, does; what it held. */
  #disposed(object: RunObject): readonly Value[] {
    const released = this.#disposedHolding(object);
    const disposed = this.#weakReferences.get(object)?.disposed;
    if (disposed !== undefined) {
      this.settle(disposed, null);
    }
    return released;
  }

  #disposedHolding(object: RunObject): readonly Value[] {
    const weak = this.#weakReferences.get(object);
    if (weak !== undefined) {
      weak.target = undefined;
    }
    if (object instanceof Cell) {
      if (object.dispose !== undefined) {
        const result = this.call(object.dispose, [object as unknown as Value]);
        this.lifetimes.letGo(result as Value);
      }
      return object.counted ? [object.value] : [];
    }
    if (object instanceof Future) {
      if (!object.settled) {
        for (const cancel of object.cancels.splice(0)) {
          cancel();
        }
      }
      if (object.execution !== undefined) {
        this.#stop(object.execution);
      }
      const callbacks = object.callbacks
        .splice(0)
        .flatMap(({ callback, standing }) => [callback, standing]);
      const held = [...callbacks, ...object.onAwaited.splice(0)];
      return object.settled ? [object.value, ...held] : held;
    }
    if (object instanceof Resource) {
      object.disposed = true;
      this.#resources.delete(object.payload);
      // A host's value: its host releases it through the type's `dispose` (§7, §9).
      const dispose = disposeOf(this.definition.types, object.type);
      if (dispose !== undefined) {
        this.lifetimes.letGo(this.call(dispose, [object as unknown as Value]) as Value);
      }
    }
    if (object instanceof MockObject) {
      this.mocks.release(object);
      return [object.replacement, ...object.calls];
    }
    return [];
  }

  // Panics.

  /** The panic `error` is, its trace read off its stack; anything else is a bug, rethrown. */
  panicOf(error: unknown): { readonly message: string; readonly trace: string } {
    const panic = panicOf(error);
    if (panic === undefined) {
      throw error;
    }
    const cause = panic.cause instanceof Error ? panic.cause : panic;
    return { message: panic.message, trace: panic.trace ?? this.#traces.of(cause.stack) };
  }

  /** Where every running frame is, innermost first, as an `Error`'s `trace` reads (§3.12). */
  trace(): string {
    return this.#traces.of(new Error().stack);
  }

  /** The trace of the code a default gives its value to. */
  callerTrace(): string {
    return this.#traces.callerOf(new Error().stack);
  }
}

/** Ranks in order: element by element, a rank before the longer ranks it begins. */
function compareRanks(first: readonly bigint[], second: readonly bigint[]): number {
  for (let at = 0; at < Math.min(first.length, second.length); at += 1) {
    const a = first[at] ?? 0n;
    const b = second[at] ?? 0n;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return first.length - second.length;
}
