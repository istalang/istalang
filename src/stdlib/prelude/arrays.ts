/**
 * The prelude's natives for arrays (§3.8, §3.9, §3.10): reading, `&self` methods and indexing.
 *
 * An array is an immutable value, so a method taking `&self` builds the changed array and writes
 * it back through its context (runtime/natives.ts). Elements compare with the built-in `==`.
 */

import { valuesEqual } from '../../definition/equality.ts';
import { parameterKey, referenceKey } from '../../definition/extern-key.ts';
import { elementsOf } from '../../definition/values.ts';
import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import { arrayOf, int, optionalValue, resultOptional, text } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { atPosition, checkedIndex, spanOf } from './positions.ts';

const item = parameterKey('T');
const array = knownTypeKey(wellKnown.array, item);
const range = knownTypeKey(wellKnown.range);
const what = 'an array';

export const arrayNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('length', array)]: ([xs]) => BigInt(elementsOf(xs).length),
  [keys.of('at', array, 'int')]: ([xs, index], context) => {
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
  [keys.of('slice', array, 'int', knownTypeKey(wellKnown.optional, 'int'))]: ([xs, start, end]) => {
    const last = optionalValue(end);
    return arrayOf(
      elementsOf(xs).slice(Number(int(start)), last === undefined ? undefined : Number(int(last))),
    );
  },
  [keys.of('indexOf', array, item)]: ([xs, element]) =>
    BigInt(elementsOf(xs).findIndex((each) => valuesEqual(each, element ?? null))),
  [keys.of('includes', array, item)]: ([xs, element]) =>
    elementsOf(xs).some((each) => valuesEqual(each, element ?? null)),
  [keys.of('join', knownTypeKey(wellKnown.array, 'string'), 'string')]: ([xs, separator]) =>
    elementsOf(xs).map(text).join(text(separator)),
  [keys.of('index', array, 'int')]: ([xs, index]) => {
    const elements = elementsOf(xs);
    return elements[checkedIndex(int(index), elements.length, what)] ?? null;
  },
  [keys.of('index', array, range)]: ([xs, span]) => {
    const elements = elementsOf(xs);
    return arrayOf(elements.slice(...spanOf(span ?? null, elements.length, what)));
  },
  [keys.of('setIndex', referenceKey(array), 'int', item)]: ([xs, index, element], context) => {
    const elements = elementsOf(xs);
    const position = checkedIndex(int(index), elements.length, what);
    context.write(0, arrayOf(elements.with(position, element ?? null)));
    return null;
  },
  [keys.of('setIndex', referenceKey(array), range, array)]: ([xs, span, replacement], context) => {
    const elements = elementsOf(xs);
    const [start, end] = spanOf(span ?? null, elements.length, what);
    context.write(0, arrayOf(elements.toSpliced(start, end - start, ...elementsOf(replacement))));
    return null;
  },
  [keys.ofStatic(wellKnown.array.name, 'default')]: () => arrayOf([]),
});
