/**
 * The prelude's natives for ranges (§3.8, §3.9): what iterating a `Range` and `in` read of one,
 * through the one reading of its values (stdlib/ranges.ts).
 */

import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { int } from '../native-values.ts';
import { bounded, countOf, rangeOf, reaches } from '../ranges.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

const range = knownTypeKey(wellKnown.range);

export const rangeNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('_steps', range)]: ([value], context) => {
    const iterated = bounded(rangeOf(context, value), 'Iterating');
    return { kind: 'tuple', elements: [iterated.start, iterated.step, countOf(iterated)] };
  },
  [keys.of('includes', range, 'Int')]: ([value, item], context) =>
    reaches(rangeOf(context, value), int(item)),
});
