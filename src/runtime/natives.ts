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
 * extern being called, its declared result and type arguments, and the Definition's types (for building typed values), the time the segment
 * started, which is what `now()` means (§5), the futures the runtime creates for an extern that
 * returns one (§3.6), the instance's shared cells, its slots (§6), its weak references and its
 * resources (§7). A
 * native never holds the context beyond its call.
 */

import type { TypeId } from '../definition/operands.ts';
import type { TypeDefinition } from '../definition/types.ts';
import type { Value } from '../definition/values.ts';

/**
 * The running instance's shared cells, which `Shared<T>` values are handles to (§3.8): a cell of
 * the `Shared<T>` type entry `type` made holding `value`, and a cell's value read and written.
 */
export interface NativeCells {
  readonly create: (type: TypeId, value: Value) => Value;
  readonly read: (cell: Value) => Value;
  readonly write: (cell: Value, value: Value) => void;
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

/** The running instance's slots (§6): every operation returns a handle to its future. */
interface NativeSlots {
  /** A new, empty slot. */
  readonly create: () => Value;
  readonly operate: (slot: Value, operation: 'put' | 'take' | 'read', value?: Value) => Value;
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
  /** A future that resolves when the referent of `weak` is disposed, never if it has none left. */
  readonly watch: (weak: Value) => Value;
  /** A watch on `weak`, already resolved once its referent is disposed. */
  readonly whenDisposed: (weak: Value) => Value;
}

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
  /** Milliseconds since the Unix epoch at which the current segment started. */
  readonly segmentStartedAt: bigint;
  /** A future that resolves at `at`, in milliseconds since the Unix epoch (`time.at`). */
  readonly timer: (at: bigint) => Value;
  /** A future already resolved with `value`. */
  readonly resolved: (value: Value) => Value;
  /** A future the host fills later, naming it by `token` (§9). */
  readonly pending: (token: string) => Value;
  /** A future of the first of `futures` to resolve, with its position (`futures.first`, §3.8). */
  readonly first: (futures: readonly Value[]) => Value;
  /**
   * Replaces the value of argument `position`, which the extern takes by `&` (§3.7): the native
   * receives such an argument's value, and writes the changed one back here.
   */
  readonly write: (position: number, value: Value) => void;
  /** Where every running frame is, innermost first, as an `Error`'s `trace` reads (§3.12). */
  readonly trace: () => string;
  readonly cells: NativeCells;
  readonly slots: NativeSlots;
  readonly weak: NativeWeakSide;
  readonly resources: NativeResources;
}

export type Native = (argumentValues: readonly Value[], context: NativeContext) => Value;

/** Natives by extern key, such as `prelude.add(int, float)`. */
export type Natives = Readonly<Record<string, Native>>;

/** Thrown by a native to panic the instance (§3.12). */
export class Panic extends Error {
  override readonly name = 'Panic';
}
