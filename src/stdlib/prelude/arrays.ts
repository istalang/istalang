/**
 * The prelude's natives for arrays (§3.8, §3.9, §3.10, §3.11): reading, `&self` methods, indexing,
 * and what an array pattern reads.
 * Methods taking a function are the prelude's code (prelude.ista), since only code calls one.
 *
 * An array is an immutable value, so a method taking `&self` builds the changed array and writes
 * it back through its context (runtime/natives.ts). Elements compare with the built-in `==`.
 */

import { parameterKey, referenceKey } from '../../definition/extern-key.ts';
import { valuesEqual } from '../../definition/values/equality.ts';
import { elementsOf } from '../../definition/values/values.ts';
import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { resultOptional } from '../native-results.ts';
import { arrayOf, int, optionalInt, text } from '../native-values.ts';
import { atPosition, checkedIndex, replaced, selected, selectionOf, sliced } from '../positions.ts';
import { rangeOf } from '../ranges.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

const item = parameterKey('T');
const array = knownTypeKey(wellKnown.array, item);
const range = knownTypeKey(wellKnown.range);
const what = 'an array';

export const arrayNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('length', array)]: ([xs]) => BigInt(elementsOf(xs).length),
  [keys.of('at', array, 'Int')]: ([xs, index], context) => {
    const elements = elementsOf(xs);
    const position = atPosition(int(index), elements.length);
    return resultOptional(context, position === undefined ? undefined : elements[position]);
  },
  [keys.of('push', referenceKey(array), item)]: ([xs, element], context) => {
    context.write(0, arrayOf([...elementsOf(xs), element ?? null]));
    return null;
  },
  [keys.of('pop', referenceKey(array))]: ([xs], context) => {
    const elements = elementsOf(xs);
    context.write(0, arrayOf(elements.slice(0, -1)));
    return resultOptional(context, elements.at(-1));
  },
  [keys.of('slice', array, 'Int', knownTypeKey(wellKnown.optional, 'Int'))]: (
    [xs, start, end],
    context,
  ) => arrayOf(sliced(elementsOf(xs), int(start), optionalInt(context, end))),
  [keys.of('indexOf', array, item)]: ([xs, element]) =>
    BigInt(elementsOf(xs).findIndex((each) => valuesEqual(each, element ?? null))),
  [keys.of('lastIndexOf', array, item)]: ([xs, element]) =>
    BigInt(elementsOf(xs).findLastIndex((each) => valuesEqual(each, element ?? null))),
  [keys.of('reverse', referenceKey(array))]: ([xs], context) => {
    context.write(0, arrayOf(elementsOf(xs).toReversed()));
    return null;
  },
  [keys.of('flat', knownTypeKey(wellKnown.array, array))]: ([xss]) =>
    arrayOf(elementsOf(xss).flatMap((inner) => elementsOf(inner))),
  [keys.of('includes', array, item)]: ([xs, element]) =>
    elementsOf(xs).some((each) => valuesEqual(each, element ?? null)),
  [keys.of('join', knownTypeKey(wellKnown.array, 'String'), 'String')]: ([xs, separator]) =>
    elementsOf(xs).map(text).join(text(separator)),
  [keys.of('index', array, 'Int')]: ([xs, index]) => {
    const elements = elementsOf(xs);
    return elements[checkedIndex(int(index), elements.length, what)] ?? null;
  },
  [keys.of('index', array, range)]: ([xs, span], context) => {
    const elements = elementsOf(xs);
    return arrayOf(selected(elements, selectionOf(rangeOf(context, span), elements.length, what)));
  },
  [keys.of('setIndex', referenceKey(array), 'Int', item)]: ([xs, index, element], context) => {
    const elements = elementsOf(xs);
    const position = checkedIndex(int(index), elements.length, what);
    context.write(0, arrayOf(elements.with(position, element ?? null)));
    return null;
  },
  [keys.of('setIndex', referenceKey(array), range, array)]: ([xs, span, replacement], context) => {
    const elements = elementsOf(xs);
    const selection = selectionOf(rangeOf(context, span), elements.length, what);
    context.write(0, arrayOf(replaced(elements, selection, elementsOf(replacement))));
    return null;
  },
  [keys.ofStatic(wellKnown.array.name, 'default')]: () => arrayOf([]),
  ...patternNatives(keys),
});

/** What an array pattern reads once its length test passed (§3.11). */
const patternNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('_patternItem', array, 'Int')]: ([xs, offset]) => {
    const elements = elementsOf(xs);
    const position = atPosition(int(offset), elements.length);
    return elements[position ?? checkedIndex(int(offset), elements.length, what)] ?? null;
  },
  [keys.of('_patternRest', array, 'Int', 'Int')]: ([xs, before, after]) => {
    const elements = elementsOf(xs);
    return arrayOf(elements.slice(Number(int(before)), elements.length - Number(int(after))));
  },
});
