/**
 * What checking a construct that could fail to match gives the walk of a pattern that may fail
 * (§11.3): the tests lowering runs and a shape for exhaustiveness. A target has none, so the walk
 * refuses those constructs there (walk/index.ts).
 */

import { neverTest, type PatternTest } from '../../../surface/checked-pattern.ts';
import { neverType } from '../../../types/type/primitives.ts';
import { nothingShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import type { ValuePart } from './parts.ts';

/** What a refutable construct gives the walk: its tests, and its shape (undefined: a guard). */
export interface Leaf {
  readonly tests: readonly PatternTest[];
  readonly shape: Shape | undefined;
}

/** Nothing to test, after a report; a guard for exhaustiveness. */
export const failed: Leaf = { tests: [], shape: undefined };

/** A construct its part's type rules out (§11.3): it never matches, so it covers nothing. */
export const ruledOutLeaf: Leaf = { tests: [neverTest], shape: nothingShape };

/**
 * What a pattern selects of its part before taking it apart (selections.ts): its test, the part the
 * rest of the pattern takes, whether the selection says all there is to match, and the pattern's
 * shape given the rest's.
 */
export interface Selection {
  readonly test: PatternTest;
  readonly part: ValuePart;
  readonly decided: boolean;
  readonly shapeOf: (inside: Shape | undefined) => Shape | undefined;
}

/**
 * A selection its part's type rules out (§11.3): the pattern never matches there, so nothing past
 * it is taken apart, and what it binds has no value.
 */
export function ruledOutSelection(part: ValuePart): Selection {
  return {
    test: neverTest,
    part: { type: neverType, path: part.path },
    decided: true,
    shapeOf: () => nothingShape,
  };
}
