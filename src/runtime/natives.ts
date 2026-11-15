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
 * for an extern that returns one (§3.6), its waits and language resolvers and its slots (§6), its
 * weak references and its resources (§7), its random source and its log (§3.8), its instances and
 * a live run's contexts (§9), what a test reaches (§10), and the JSON it wrote values as (§9). Every capability has
 * one shape, a member of the context, and the runtime builds them once per segment. A native
 * states the capabilities it uses and never holds the context beyond its call.
 */

import type { FunctionId, TypeId } from '../definition/operands.ts';
import type { TypeDefinition, TypeReference } from '../definition/tables/types.ts';
import type { Value } from '../definition/values/values.ts';
import type { Inspection, LogRecord, SpawnOptions } from './instance-state.ts';
import type { CallMaker } from './scheduler/run-contexts.ts';
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
  /** The extern's type arguments, in order (`json.parse<T>`), as the Definition refers to types. */
  readonly typeArguments: readonly TypeReference[];
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
   * The changes the native makes to the value of argument `position`, which the extern takes by `&`
   * (§3.7): each in place when nothing else holds it, else in a copy that takes its place
   * (lifetimes/in-place.ts).
   */
  readonly changes: (position: number) => ValueChanges;
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
  /** A future that resolves at `at`, in milliseconds since the Unix epoch (`time.at`). */
  readonly timer: (at: bigint) => Value;
  /** A live future something outside the run resolves, and its resolver: a live run's (proposal 8). */
  readonly resolvable: () => Resolvable;
}

/**
 * The running instance's waits (proposal 8, Rule 5): the resolvers `await` and `select` hand an
 * awaitable's `onAwait`, which a future registers and code resolves.
 */
export interface NativeWaits {
  /** Resolves the resolver `done` as the future `future` resolves: at once when it has (`onAwait`). */
  readonly onAwait: (future: Value, done: Value) => void;
  /** Resolves `done` with `value`: nothing once it is cancelled, a panic once it resolved. */
  readonly resolve: (done: Value, value: Value) => void;
  /** Resolves `done` with `value` if it is pending; whether it took `value`. */
  readonly tryResolve: (done: Value, value: Value) => boolean;
  /** A new resolver calling the function value `callback` with its value (`Resolver.of`). */
  readonly callback: (callback: Value) => Value;
  /** A new resolver deciding `done` with `(position, value)` (`Resolver.at`). */
  readonly at: (done: Value, position: bigint) => Value;
  /** Has the function value `callback` called once `done` is cancelled. */
  readonly onCancel: (done: Value, callback: Value) => void;
}

/** Whether a resolver waits for its value, took one or failed, or lost its future first. */
export type ResolverState = 'pending' | 'resolved' | 'cancelled';

/** A live future's one-shot resolver, as a native resolves it (proposal 8, Rules 5 and 9). */
export interface NativeResolver {
  readonly state: ResolverState;
  /** Resolves its future with `value` unless it is no longer pending; whether it took `value`. */
  readonly tryResolve: (value: Value) => boolean;
  /** Fails its wait unless it is no longer pending: its run panics with `panic`. */
  readonly fail: (panic: Panic) => void;
  /** Panics its run with `panic`, however it stands: whoever resolves it misused it. */
  readonly panic: (panic: Panic) => void;
  /** Has `callback` called once its future is disposed unresolved. */
  readonly onCancel: (callback: () => void) => void;
}

/** A live future, and the resolver that resolves it. */
export interface Resolvable {
  readonly future: Value;
  readonly resolver: NativeResolver;
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
   * segment commits, its outcome encoded by the encoder `Instance<T>` type entry `type` names; a
   * handle to it of that type. Every native starting an instance does so here.
   */
  readonly spawn: (entry: Value, type: TypeId, options: SpawnOptions) => Value;
  /** A future that resolves with a `Result` of type entry `result` once `instance` has ended. */
  readonly ended: (instance: string, result: TypeId) => Value;
}

/**
 * The contexts live code runs ista code in (§9): instances named by key, in the host's store, run
 * by the runtimes the live run opens over it while it runs. Only a live run has them; the call rule
 * keeps ista code from these natives (proposal 8, Rule 2).
 */
/**
 * A call into a context as code makes it: the context's key, the closure it calls, which takes
 * nothing, the type entry of the `Result` its future gives, and who makes it.
 */
interface NativeContextCall {
  readonly key: string;
  readonly call: Value;
  readonly result: TypeId;
  readonly maker: CallMaker;
}

export interface NativeContexts {
  /** The host's store, a value of the extern type entry `type`. */
  readonly hostStore: (type: TypeId) => Value;
  /**
   * A runtime over `store`, a resource of the extern type entry `type`, which resumes the work
   * persisted there and runs it while the live run does, until it is disposed, which stops it.
   */
  readonly open: (store: Value, type: TypeId) => Value;
  /**
   * Makes `call` into its context of `runtime`, made if new: a live future resolving with a
   * `Result` of type entry `call.result`, `Ok` of what the call gave, or `Err` once the context
   * panicked (code `panic`).
   */
  readonly call: (runtime: Value, call: NativeContextCall) => Value;
  /**
   * A live future resolving with the names of the instances `runtime` serves the jobs of, once
   * they are more than `known`: every instance it drives while it is the earliest open runtime.
   */
  readonly served: (runtime: Value, known: number) => Value;
  /** The program's job server (§5) as a function value; undefined in a program with no jobs. */
  readonly jobServer: () => Value | undefined;
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

/**
 * The JSON the running instance wrote values as (lifetimes/written-json.ts), which `json.encode`
 * gives again for a value written as the same type and unchanged since. A test world keeps none.
 */
export interface NativeEncodings {
  /** The `Json` `value` was written as, a `type`; undefined if it wasn't, or isn't kept. */
  readonly of: (value: Value, type: TypeReference) => Value | undefined;
  /** Keeps `json` as what `value` was written as, a `type`. */
  readonly remember: (value: Value, type: TypeReference, json: Value) => void;
}

export interface WithFutures {
  readonly futures: NativeFutures;
}
export interface WithWaits {
  readonly waits: NativeWaits;
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

export interface WithContexts {
  readonly contexts: NativeContexts;
}
export interface WithEncodings {
  readonly encodings: NativeEncodings;
}

/** Every capability: what the runtime gives each native. */
export type NativeCapabilities = WithFutures &
  WithWaits &
  WithSlots &
  WithWeakSide &
  WithResources &
  WithRandom &
  WithLogs &
  WithInstances &
  WithTesting &
  WithContexts &
  WithEncodings;

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

/**
 * Thrown by a native to panic the instance (§3.12), where its code stands, or at `trace` for a
 * panic raised again from elsewhere, as a context's panic is in the live code that called it (§9).
 */
export class Panic extends Error {
  override readonly name = 'Panic';
  readonly trace: string | undefined;

  constructor(message: string, options?: ErrorOptions & { readonly trace?: string }) {
    super(message, options);
    this.trace = options?.trace;
  }
}

/** The changes a native makes to the array or map it takes by `&`, as `NativeContext.changes` gives them. */
export interface ValueChanges {
  readonly push: (items: readonly Value[]) => void;
  /** Removes the last element; it, or undefined for an empty array. */
  readonly pop: () => Value | undefined;
  readonly reverse: () => void;
  /** Replaces `count` elements from `start` with `items`. */
  readonly splice: (start: number, count: number, items: readonly Value[]) => void;
  /** Sets `key` to `value`: a key the map holds keeps its place, a new one goes last. */
  readonly setEntry: (key: Value, value: Value) => void;
  /** Deletes `key`'s entry; whether the map had one. */
  readonly deleteEntry: (key: Value) => boolean;
}
