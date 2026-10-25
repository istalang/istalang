/**
 * The `Natives` seam: the host's and the runtime's implementations of extern functions, bound by
 * key when a Definition loads (docs/arch/definition.md, "Externs"). The app's composition root
 * assembles the table: the std modules' natives, the host's externs, test mocks.
 *
 * A native takes its arguments as values and returns one; an argument the extern takes by `&` it
 * changes by writing it back through its context. It signals a bug in the program, such as
 * a division by zero, by throwing a `Panic` (§3.12); anything else it throws is a bug in the
 * native itself and propagates.
 *
 * Natives the runtime backs need the running instance, so each call also receives a context: the
 * function-table entry being called and the Definition's types (for building typed values), the time the segment
 * started, which is what `now()` means (§5), and the futures the runtime creates for an extern that
 * returns one (§3.6). A native never holds the context beyond its call.
 */

import type { FunctionDefinition } from '../definition/functions.ts';
import type { TypeDefinition } from '../definition/types.ts';
import type { Value } from '../definition/values.ts';

export interface NativeContext {
  /** The entry called: its extern's declared types, or a code entry a mock replaced. */
  readonly entry: FunctionDefinition;
  /** The Definition's types, which the entry's types index, for building values of them. */
  readonly types: readonly TypeDefinition[];
  /** Milliseconds since the Unix epoch at which the current segment started. */
  readonly segmentStartedAt: bigint;
  /** A future that resolves at `at`, in milliseconds since the Unix epoch (`time.at`). */
  readonly timer: (at: bigint) => Value;
  /** A future already resolved with `value`. */
  readonly resolved: (value: Value) => Value;
  /**
   * Replaces the value of argument `position`, which the extern takes by `&` (§3.7): the native
   * receives such an argument's value, and writes the changed one back here.
   */
  readonly write: (position: number, value: Value) => void;
  /** Where every running frame is, innermost first, as an `Error`'s `trace` reads (§3.12). */
  readonly trace: () => string;
}

export type Native = (argumentValues: readonly Value[], context: NativeContext) => Value;

/** Natives by extern key, such as `prelude.add(int, float)`. */
export type Natives = Readonly<Record<string, Native>>;

/** Thrown by a native to panic the instance (§3.12). */
export class Panic extends Error {
  override readonly name = 'Panic';
}
