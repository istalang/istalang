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

import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/tables/functions.ts';
import { lifetimeOf } from '../../definition/tables/types.ts';
import { mapOf, valuesEqual } from '../../definition/values/equality.ts';
import type { Value } from '../../definition/values/values.ts';
import type { EmittedProgram } from '../../codegen/emit.ts';
import { panicOf } from '../natives.ts';
import { bindNatives, type NativeBinding } from './natives.ts';
import { runNatives } from './run-natives.ts';
import { Lifetimes } from './lifetimes.ts';
import {
  Cell,
  Execution,
  type Frame,
  Future,
  Reference,
  Resource,
  type RunObject,
  type Step,
  WeakReference,
} from './objects.ts';
import * as primitives from './primitives.ts';
import { Traces } from './traces.ts';

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
  | { readonly kind: 'call'; readonly closure: Value; readonly arguments: readonly Value[] };

export class Run {
  readonly definition: Definition;
  readonly constants: readonly Value[];
  readonly lifetimes: Lifetimes;
  readonly #entries: readonly Entry[];
  readonly #traces: Traces;
  readonly #natives: (index: number) => Entry;
  readonly #ready: Ready[] = [];
  #objects = 0;
  /** The transients shared now, by `function:register`, innermost last (§3.4). */
  readonly #transients = new Map<string, Cell[]>();
  readonly #contextConstants = new Map<string, Value>();
  readonly #weakReferences = new WeakMap<RunObject, WeakReference>();
  /** The execution running now, whose code a native or `currentCall` reads. */
  #running: Execution | undefined;

  constructor(definition: Definition, program: EmittedProgram, binding: NativeBinding) {
    this.definition = definition;
    this.lifetimes = new Lifetimes((object) => this.#disposed(object));
    this.constants = definition.constants;
    for (const constant of this.constants) {
      this.lifetimes.share(constant);
    }
    this.#natives = bindNatives(this, {
      ...binding,
      natives: { ...binding.natives, ...runNatives(this) },
    });
    const made = new Function('rt', program.body) as (
      rt: Run,
    ) => { readonly site: Error; readonly entries: readonly Entry[] };
    const { site, entries } = made(this);
    this.#entries = entries;
    this.#traces = new Traces(definition, program.lines, site);
  }

  // What compiled code calls.

  readonly hold = (value: Value | undefined): void => this.lifetimes.hold(value);
  readonly share = (value: Value | undefined): void => this.lifetimes.share(value);
  readonly letGo = (value: Value | undefined): void => this.lifetimes.letGo(value);
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
  readonly load = (kind: 'register' | 'cell' | 'reference', root: Value, path: readonly Step[]): Value => {
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
  readonly contextConstant = (name: string): Value | undefined => this.#contextConstants.get(name);

  readonly makeContextConstant = (name: string, value: Value): void => {
    this.lifetimes.hold(value);
    this.#contextConstants.set(name, value);
  };

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
    return entry?.kind === 'code' ? run(...passed, closure) : run(...passed);
  }

  /** Starts async entry `index` with `passed`: runs it until it parks or returns; its future. */
  readonly start = (index: number, passed: readonly Value[], closure: Value | undefined): Future => {
    const entry = this.definition.functions[index] as CodeFunction;
    const execution = new Execution(this.newId(), this.newId());
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

  readonly mocked = (): typeof NOT_MOCKED => NOT_MOCKED;

  readonly unreachableHere = (): Error => new Error('Control reached code no path reaches.');

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

  /** Readies `execution` to resume with `decision`, the position its wait was decided for. */
  unpark(execution: Execution, decision: Value): void {
    this.#ready.push({ kind: 'resume', execution, decision });
  }

  /** Readies a call of `closure` with `passed`. */
  enqueue(closure: Value, passed: readonly Value[]): void {
    this.#ready.push({ kind: 'call', closure, arguments: passed });
  }

  /**
   * Settles `future` with `value`, which it holds, calling every callback waiting on it at once, in
   * the settle order (spec §8): by rank, then as they were added.
   */
  settle(future: Future, value: Value): void {
    if (future.settled) {
      return;
    }
    future.settled = true;
    future.value = value;
    const waiting = future.callbacks.splice(0).toSorted((first, second) => compareRanks(first.rank, second.rank));
    for (const { callback } of waiting) {
      const result = this.callValue(callback, [value]);
      this.lifetimes.letGo(result as Value);
      this.lifetimes.letGo(callback);
    }
  }

  /** Runs the ready queue until it is empty. */
  drain(): void {
    for (let next = this.#ready.shift(); next !== undefined; next = this.#ready.shift()) {
      if (next.kind === 'resume') {
        this.#resume(next.execution, next.decision);
      } else {
        const result = this.callValue(next.closure, next.arguments);
        this.lifetimes.letGo(result as Value);
      }
    }
  }

  #resume(execution: Execution, decision: unknown): void {
    if (execution.ended) {
      return;
    }
    const outer = this.#running;
    this.#running = execution;
    const { frame } = execution;
    frame.decision = decision as Value;
    try {
      const result = (this.#entries[frame.function] as (given: Frame) => unknown)(frame);
      if (result === PARKED) {
        return;
      }
      execution.ended = true;
      if (result !== STOPPED) {
        this.settle(execution.future, result as Value);
      }
    } finally {
      this.#running = outer;
    }
  }

  /** What disposing `object`, which lost its last holder, does; what it held. */
  #disposed(object: RunObject): readonly Value[] {
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
      const callbacks = object.callbacks.splice(0).map(({ callback }) => callback);
      return object.settled ? [object.value, ...callbacks] : callbacks;
    }
    if (object instanceof Resource) {
      object.disposed = true;
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
