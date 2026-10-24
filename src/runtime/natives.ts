/**
 * The `Natives` seam: the host's and the runtime's implementations of extern functions, bound by
 * key when a Definition loads (docs/arch/definition.md, "Externs"). The app's composition root
 * assembles the table: the std modules' natives, the host's externs, test mocks.
 *
 * A native takes its arguments as values and returns one. It signals a bug in the program, such as
 * a division by zero, by throwing a `Panic` (§3.12); anything else it throws is a bug in the
 * native itself and propagates.
 */

import type { Value } from '../definition/values.ts';

export type Native = (argumentValues: readonly Value[]) => Value;

/** Natives by extern key, such as `prelude.add(int, float)`. */
export type Natives = Readonly<Record<string, Native>>;

/** Thrown by a native to panic the instance (§3.12). */
export class Panic extends Error {
  override readonly name = 'Panic';
}
