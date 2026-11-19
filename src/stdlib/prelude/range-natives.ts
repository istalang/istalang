/**
 * The prelude's natives for ranges (§19.3, §10.2): what iterating a `Range` and `in` read of one,
 * through the one reading of its values (stdlib/ranges.ts).
 */

import type { NativeKeys } from '../../definition/extern-key.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { bounded, countOf, rangeOf, reaches } from '../ranges.ts';
import { knownTypeKey } from '../std-module.ts';
import { int } from '../values/arguments.ts';

const range = knownTypeKey(wellKnown.range);

export const rangeNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('_steps', range)]: ([value], context) => {
    const iterated = bounded(rangeOf(context, value), 'Iterating');
    return { kind: 'tuple', elements: [iterated.start, iterated.step, countOf(iterated)] };
  },
  [keys.of('includes', range, 'Int')]: ([value, item], context) =>
    reaches(rangeOf(context, value), int(item)),
});
