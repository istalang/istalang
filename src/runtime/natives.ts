/**
 * The `Natives` seam: the host's and the runtime's implementations of extern functions, bound by
 * key when a Definition loads (docs/arch/definition.md, "Externs"). The app's composition root
 * assembles the table: the std modules' natives, the host's externs, test mocks.
 *
 * A native takes its arguments as values and returns one; an argument the extern takes by `&` it
 * changes by writing it back through its context. It signals a bug in the program, such as
 * a division by zero, by throwing a `Panic` (§3.12), and JSON from the host that doesn't fit (§9)
 * by throwing a `Refusal` (runtime/refusal.ts), which fails the host's call so nothing it ran
 * commits; anything else it throws is a bug in the native itself and propagates.
 *
 * Natives the runtime backs need the running instance, so each call also receives a context: the
 * extern being called, its declared result and type arguments, and the Definition's types (for
 * building typed values), what `now()` reads (§5), and
 * capabilities, one per part of the instance a native reaches: the futures the runtime creates
 * for an extern that returns one (§3.6), its slots (§6), its weak references and its resources
 * (§7), its random source and its log (§3.8), and what a test reaches (§10). Every capability has
 * one shape, a member of the context, and the runtime builds them once per segment. A native
 * states the capabilities it uses and never holds the context beyond its call.
 */

import type { FunctionId, TypeId } from '../definition/operands.ts';
import type { TypeDefinition } from '../definition/tables/types.ts';
import type { Value } from '../definition/values/values.ts';
import type { Inspection, LogRecord, SpawnOptions } from './instance-state.ts';
import type { TestWatch } from './snapshot/objects.ts';

/** Base context every native gets: the call, and the segment it runs in. */
export interface NativeContext {
  /** The extern called, by its declared name. */
  readonly name: string;
  /**
   * The type entry the extern's declared result names (a struct, an enum, `Shared` or `Future`);
   * undefined for any other result, and for a code entry a mock replaced.
   */
  readonly resultType: TypeId | undefined;
  /** The type entry each of the extern's type arguments names, in order (`json.parse<T>`). */
  readonly typeArguments: readonly (TypeId | undefined)[];
  /** The Definition's types, which the extern's types index, for building values of them. */
  readonly types: readonly TypeDefinition[];
  /** The instance whose code called the native, as its host names it (§9). */
  readonly instance: string;
  /** The content hash of the Definition the instance runs, fixed for its life (§5). */
  readonly version: string;
  /**
   * Milliseconds since the Unix epoch, as `now()` reads them (§5): when the segment started, in an
   * instance, so a segment run again reads the same; the clock, in a live run (proposal 8).
   */
  readonly now: () => bigint;
  /**
   * Replaces the value of argument `position`, which the extern takes by `&` (§3.7): the native
   * receives such an argument's value, and writes the changed one back here.
   */
  readonly write: (position: number, value: Value) => void;
  /** Where every running frame is, innermost first, as an `Error`'s `trace` reads (§3.12). */
  readonly trace: () => string;
  /**
   * The trace of the code a default gives its value to (§3.1): `trace` without the innermost
   * frame when its entry gives a default.
   */
  readonly callerTrace: () => string;
}

/** The futures the runtime makes for an extern returning one (§3.6). */
export interface NativeFutures {
  /** A future already resolved with `value`. */
  readonly resolved: (value: Value) => Value;
  /** A future of the first of `futures` to resolve, with its position (`futures.first`, §3.8). */
  readonly first: (futures: readonly Value[]) => Value;
  /** A future that resolves at `at`, in milliseconds since the Unix epoch (`time.at`). */
  readonly timer: (at: bigint) => Value;
  /** A future the host fills later, naming it by `token` (§9): an instance's. */
  readonly fromHost: (token: string) => Value;
  /**
   * A future resolved with the value `settles` gives once it settles, or, when it gives a reason
   * instead, a `Panic`, panicking its run: a live run's (proposal 8).
   */
  readonly promised: (settles: Promise<PromiseSettledResult<Value>>) => Value;
}

/** The running instance's slots (§6): `put`, `take` and `read` return a handle to its future. */
export interface NativeSlots {
  /** A new, empty slot. */
  readonly create: () => Value;
  /** The future of putting `value` into `slot`. */
  readonly put: (slot: Value, value: Value) => Value;
  /** The future of taking `slot`'s value, which empties it. */
  readonly take: (slot: Value) => Value;
  /** The future of reading `slot`'s value, which leaves it full. */
  readonly read: (slot: Value) => Value;
}

/**
 * The running instance's weak references (§7). A referent is a handle to a disposable, and each
 * has one weak reference, which holds nothing.
 */
export interface NativeWeakSide {
  /** The weak reference to `referent`. */
  readonly reference: (referent: Value) => Value;
  /** A handle to what `weak` refers to, until it is disposed. */
  readonly target: (weak: Value) => Value | undefined;
  /**
   * A future that resolves when the referent of `weak` is disposed, already resolved once a
   * non-call referent was, and never once a call entered cleanup or returned.
   */
  readonly watch: (weak: Value) => Value;
}

/**
 * The running instance's resources (§7): values of a host type a `dispose` makes disposable, each
 * an object holding its host's JSON, `payload`, made as the value arrives from the host.
 */
export interface NativeResources {
  /** A new resource of the host type entry `type`, holding `payload`; a handle to it. */
  readonly create: (type: TypeId, payload: unknown) => Value;
  /** What the resource `handle` points at holds. */
  readonly payloadOf: (handle: Value) => unknown;
}

/** The instances the running one spawns and waits for (§9). */
export interface NativeInstances {
  /**
   * Spawns the closure `entry`, which takes nothing, as a new instance with `options` once the
   * segment commits; a handle to it of `Instance<T>` type entry `type`.
   */
  readonly spawn: (entry: Value, type: TypeId, options: SpawnOptions) => Value;
  /** A future that resolves with a `Result` of type entry `result` once `instance` has ended. */
  readonly ended: (instance: string, result: TypeId) => Value;
}

/**
 * What a test reaches through the `testing` module (§10): mocks, which its calls and those of the
 * instances it spawns reach, waits on those instances, and host values equal to no other. A read
 * of another instance's last commit that only the runtime running a test can answer
 * (runtime/testing/) panics anywhere else.
 */
export interface NativeTesting {
  /** A mock replacing `target` with `replacement` while it is held; its handle. */
  readonly mock: (target: FunctionId, replacement: Value) => Value;
  /** The calls the mock `mock` names recorded, oldest first. */
  readonly calls: (mock: Value) => readonly Value[];
  /** Where `instance` stands and waits, as its last commit says; undefined before its first. */
  readonly inspect: (instance: string) => Inspection | undefined;
  /** A future that resolves once `instance` is idle, or waits at a waypoint. */
  readonly watch: (instance: string, until: TestWatch) => Value;
  /** A value of the host type entry `type` equal to no other, held as its host holds one. */
  readonly handle: (type: TypeId) => Value;
}

/** The running instance's random source (§3.8 `random`, snapshot/random.ts). */
export interface NativeRandom {
  /** The next draw, 32 bytes; a segment that runs again draws the same ones (§5). */
  readonly draw: () => Uint8Array;
}

/**
 * The running instance's log (§3.8 `log`): a record joins its segment's, stamped with the instance
 * and the segment's start time, and reaches the host only once the segment commits.
 */
export interface NativeLogs {
  readonly write: (entry: Omit<LogRecord, 'instance' | 'time'>) => void;
}

export interface WithFutures {
  readonly futures: NativeFutures;
}
export interface WithSlots {
  readonly slots: NativeSlots;
}
export interface WithWeakSide {
  readonly weak: NativeWeakSide;
}
export interface WithResources {
  readonly resources: NativeResources;
}
export interface WithRandom {
  readonly random: NativeRandom;
}
export interface WithLogs {
  readonly logs: NativeLogs;
}
export interface WithInstances {
  readonly instances: NativeInstances;
}
export interface WithTesting {
  readonly testing: NativeTesting;
}

/** Every capability: what the runtime gives each native. */
export type NativeCapabilities = WithFutures &
  WithSlots &
  WithWeakSide &
  WithResources &
  WithRandom &
  WithLogs &
  WithInstances &
  WithTesting;

export type FullNativeContext = NativeContext & NativeCapabilities;

/**
 * A native needing `Context`. The runtime calls every native with the full context, so a native
 * or a table of them states only the capabilities it uses and still joins the runtime's.
 */
export type Native<Context = FullNativeContext> = (
  argumentValues: readonly Value[],
  context: Context,
) => Value;

/** A table of natives needing `Context`, by key. */
export type Natives<Context = FullNativeContext> = Readonly<Record<string, Native<Context>>>;

/** Thrown by a native to panic the instance (§3.12). */
export class Panic extends Error {
  override readonly name = 'Panic';
}
