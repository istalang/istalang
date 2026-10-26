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
 * building typed values), the time the segment started, which is what `now()` means (§5), the
 * futures the runtime creates for an extern that returns one (§3.6), its slots (§6), its weak
 * references and its resources (§7). A native never holds the context beyond its call.
 */

import type { TypeId } from '../definition/operands.ts';
import type { TypeDefinition } from '../definition/types.ts';
import type { Value } from '../definition/values.ts';

/** The running instance's resources (§7). */
export interface NativeResources {
  readonly create: (type: TypeId, payload: unknown) => Value;
  readonly payloadOf: (handle: Value) => unknown;
}

/** The running instance's slots (§6). */
interface NativeSlots {
  readonly create: () => Value;
  readonly operate: (slot: Value, operation: 'put' | 'take' | 'read', value?: Value) => Value;
}

/** The running instance's weak references (§7). */
export interface NativeWeakSide {
  readonly reference: (referent: Value) => Value;
  readonly target: (weak: Value) => Value | undefined;
  readonly watch: (weak: Value) => Value;
  readonly whenDisposed: (weak: Value) => Value;
}

/** Base context every native gets. */
export interface NativeContext {
  readonly name: string;
  readonly resultType: TypeId | undefined;
  readonly typeArguments: readonly (TypeId | undefined)[];
  readonly types: readonly TypeDefinition[];
  readonly instance: string;
  readonly segmentStartedAt: bigint;
  readonly write: (position: number, value: Value) => void;
  readonly trace: () => string;
}

export interface NativeTimers {
  readonly timer: (at: bigint) => Value;
}
export interface NativeFutures {
  readonly resolved: (value: Value) => Value;
  readonly first: (futures: readonly Value[]) => Value;
}
export interface NativeHostFutures {
  readonly pending: (token: string) => Value;
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

export type FullNativeContext = NativeContext &
  NativeTimers &
  NativeFutures &
  NativeHostFutures &
  WithSlots &
  WithWeakSide &
  WithResources;

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
