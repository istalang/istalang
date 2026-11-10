/**
 * What a host may start (§9): the one rule the compiler, the checker, lowering and the
 * Definition's validation read, each over what it knows of a function, its checked signature or
 * its entry. Whether its arguments and outcome can cross as JSON is the checker's codecs' to say.
 *
 * - A host starts a function with a body of its own and no type parameters, since it can name no
 *   type, taking every argument by value, since it can hand over no reference.
 * - `main` is one that is async and takes nothing, so a host starts it with nothing to give.
 */

/** What the rule reads of a function. */
export interface StartShape {
  /** False for an extern, which has no body to run. */
  readonly hasBody: boolean;
  readonly isGeneric: boolean;
  readonly parameters: readonly { readonly reference: boolean }[];
  /** Whether its body may await, so its call gives a future. */
  readonly awaits: boolean;
}

/** Whether a host may start a function of `shape`. */
export function isStartable(shape: StartShape): boolean {
  return shape.hasBody && !shape.isGeneric && shape.parameters.every(({ reference }) => !reference);
}

/** Whether a function of `shape` may be the program's `main`. */
export function isMainShaped(shape: StartShape): boolean {
  return isStartable(shape) && shape.awaits && shape.parameters.length === 0;
}
