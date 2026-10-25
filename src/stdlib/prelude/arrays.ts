/**
 * The prelude's natives for arrays (§3.8, §3.9, §3.10): reading, `&self` methods and indexing.
 *
 * An array is an immutable value, so a method taking `&self` builds the changed array and writes
 * it back through its context (runtime/natives.ts). `iterate` gives the array itself: it is a copy
 * by value semantics, and values never change in place. Elements compare with the built-in `==`.
 */

import {
  namedKey,
  nativeKey,
  parameterKey,
  primitiveKey,
  referenceKey,
} from '../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import type { Natives } from '../../runtime/natives.ts';
import { valuesEqual } from '../../runtime/values/equality.ts';
import { arrayOf, elementsOf, int, optionalValue, resultOptional, text } from '../native-values.ts';
import { preludeName } from '../stdlib-loader.ts';
import { atPosition, checkedIndex, spanOf } from './positions.ts';

const item = parameterKey('T');
const array = namedKey(qualifiedName(wellKnown.array), item);
const range = namedKey(qualifiedName(wellKnown.range));
const intKey = primitiveKey('int');
const what = 'an array';

const key = (name: string, ...parameters: Parameters<typeof nativeKey>[2][]) =>
  nativeKey(preludeName, name, ...parameters);

export const arrayNatives: Natives = {
  [key('length', array)]: ([xs]) => BigInt(elementsOf(xs).length),
  [key('at', array, intKey)]: ([xs, index], context) => {
    const elements = elementsOf(xs);
    const position = atPosition(int(index), elements.length);
    return resultOptional(context, position === undefined ? undefined : elements[position]);
  },
  [key('push', referenceKey(array), item)]: ([xs, element], context) => {
    context.write(0, arrayOf([...elementsOf(xs), element ?? null]));
    return null;
  },
  [key('pop', referenceKey(array))]: ([xs], context) => {
    const elements = elementsOf(xs);
    context.write(0, arrayOf(elements.slice(0, -1)));
    return resultOptional(context, elements.at(-1));
  },
  [key('slice', array, intKey, namedKey(qualifiedName(wellKnown.optional), intKey))]: ([
    xs,
    start,
    end,
  ]) => {
    const last = optionalValue(end);
    return arrayOf(
      elementsOf(xs).slice(Number(int(start)), last === undefined ? undefined : Number(int(last))),
    );
  },
  [key('indexOf', array, item)]: ([xs, element]) =>
    BigInt(elementsOf(xs).findIndex((each) => valuesEqual(each, element ?? null))),
  [key('includes', array, item)]: ([xs, element]) =>
    elementsOf(xs).some((each) => valuesEqual(each, element ?? null)),
  [key(
    'join',
    namedKey(qualifiedName(wellKnown.array), primitiveKey('string')),
    primitiveKey('string'),
  )]: ([xs, separator]) => elementsOf(xs).map(text).join(text(separator)),
  [key('index', array, intKey)]: ([xs, index]) => {
    const elements = elementsOf(xs);
    return elements[checkedIndex(int(index), elements.length, what)] ?? null;
  },
  [key('index', array, range)]: ([xs, span]) => {
    const elements = elementsOf(xs);
    return arrayOf(elements.slice(...spanOf(span ?? null, elements.length, what)));
  },
  [key('setIndex', referenceKey(array), intKey, item)]: ([xs, index, element], context) => {
    const elements = elementsOf(xs);
    const position = checkedIndex(int(index), elements.length, what);
    context.write(0, arrayOf(elements.with(position, element ?? null)));
    return null;
  },
  [key('setIndex', referenceKey(array), range, array)]: ([xs, span, replacement], context) => {
    const elements = elementsOf(xs);
    const [start, end] = spanOf(span ?? null, elements.length, what);
    context.write(0, arrayOf(elements.toSpliced(start, end - start, ...elementsOf(replacement))));
    return null;
  },
  [key('iterate', array)]: ([xs]) => arrayOf(elementsOf(xs)),
  [key('Array.default')]: () => arrayOf([]),
};
