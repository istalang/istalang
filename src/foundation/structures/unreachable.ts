/**
 * What can't happen. A broken invariant is a bug in the toolchain, never a program's mistake (a
 * diagnostic or a panic) nor a host's (a `Refusal`), so every phase throws it as this one class:
 * a host tells a toolchain bug from its own mistake by it, and nothing catches it.
 */

/** A broken invariant: a bug in the toolchain. */
export class Unreachable extends Error {
  override readonly name = 'Unreachable';
}

/** Throws an `Unreachable` saying which invariant broke. */
export function unreachable(message: string): never {
  throw new Unreachable(message);
}
