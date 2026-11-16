/**
 * The prelude's natives for arrays (§3.8, §3.9, §3.10, §3.11): the primitives, reading, `&self`
 * methods, indexing by position and range, and what an array pattern reads, which share their
 * positions' rules with strings (positions.ts). The methods written over them, searching, joining
 * and those taking a function, are the prelude's code (prelude.ista).
 *
 * An array is a value, so a method taking `&self` changes it through its context
 * (runtime/natives.ts), which changes it in place only when nothing else holds it. Elements compare
 * with the built-in `==`.
 */

import { parameterKey, referenceKey } from '../../definition/extern-key.ts';
import { elementsOf } from '../../definition/values/values.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { NativeContext, Natives } from '../../runtime/natives.ts';
import {
  atPosition,
  checkedIndex,
  selected,
  selectionOf,
  sliced,
  splicesOf,
} from '../positions.ts';
import { rangeOf } from '../ranges.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { arrayOf, int, optionalInt } from '../values/arguments.ts';

const item = parameterKey('T');
const array = knownTypeKey(wellKnown.array, item);
const range = knownTypeKey(wellKnown.range);
const what = 'an array';

export const arrayNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('length', array)]: ([xs]) => BigInt(elementsOf(xs).length),
  [keys.of('slice', array, 'Int', knownTypeKey(wellKnown.optional, 'Int'))]: (
    [xs, start, end],
    context,
  ) => arrayOf(sliced(elementsOf(xs), int(start), optionalInt(context, end))),
  [keys.of('index', array, 'Int')]: ([xs, index]) => {
    const elements = elementsOf(xs);
    return elements[checkedIndex(int(index), elements.length, what)] ?? null;
  },
  [keys.of('index', array, range)]: ([xs, span], context) => {
    const elements = elementsOf(xs);
    return arrayOf(selected(elements, selectionOf(rangeOf(context, span), elements.length, what)));
  },
  [keys.ofStatic(wellKnown.array.name, 'default')]: () => arrayOf([]),
  [keys.of('_positionOf', 'Int', 'Int')]: ([index, length]) =>
    BigInt(atPosition(int(index), Number(int(length))) ?? -1),
  ...changingNatives(keys),
  ...patternNatives(keys),
});

/** The `&self` methods, changing the array through their context. */
const changingNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('push', referenceKey(array), item)]: ([, element], context) => {
    context.changes(0).push([element ?? null]);
    return null;
  },
  [keys.of('_popLast', referenceKey(array))]: (_values, context) => {
    const popped = context.changes(0).pop();
    return popped === undefined ? unreachable('An empty array is popped.') : popped;
  },
  [keys.of('setIndex', referenceKey(array), 'Int', item)]: ([xs, index, element], context) => {
    const position = checkedIndex(int(index), elementsOf(xs).length, what);
    context.changes(0).splice(position, 1, [element ?? null]);
    return null;
  },
  [keys.of('setIndex', referenceKey(array), range, array)]: ([xs, span, replacement], context) => {
    const selection = selectionOf(rangeOf(context, span), elementsOf(xs).length, what);
    const changes = context.changes(0);
    for (const { start, count, items } of splicesOf(selection, elementsOf(replacement))) {
      changes.splice(start, count, items);
    }
    return null;
  },
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
