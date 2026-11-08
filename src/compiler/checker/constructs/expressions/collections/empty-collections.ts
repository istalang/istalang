/**
 * What an empty collection literal can be a value of, as a constraint scope reads it before
 * checking it (../postponed.ts): with no item to tell, only what it goes into decides what it
 * builds. `[]` builds an array, a map or a struct it goes into, and `[:]` a map or a struct.
 */

import type { ArrayLiteral, MapLiteral } from '../../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import type { Admits } from '../../../types/fitting/expected.ts';
import { collectionTarget } from '../../../types/fitting/expected.ts';

/** What `node`, an empty `[]`, can be a value of. */
export function emptyArrayAdmits(context: BodyContext, _node: ArrayLiteral): Admits {
  return (expected) => collectionTarget(context.checker, expected) !== undefined;
}

/** What `node`, an empty `[:]`, can be a value of. */
export function emptyMapAdmits(context: BodyContext, _node: MapLiteral): Admits {
  return (expected) => {
    const kind = collectionTarget(context.checker, expected)?.kind;
    return kind === 'map' || kind === 'declared';
  };
}
