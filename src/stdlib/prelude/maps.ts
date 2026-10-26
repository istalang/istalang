/**
 * The prelude's natives for maps (§3.8, §3.9, §3.10): reading, `&self` methods and indexing. Keys
 * are found by the built-in `==` (definition/equality.ts), and a map is an immutable value, so
 * a method taking `&self` builds the changed map and writes it back through its context.
 */

import { entryPosition, entryValue, withEntry, withoutEntry } from '../../definition/equality.ts';
import {
  namedKey,
  parameterKey,
  preludeKey,
  primitiveKey,
  referenceKey,
} from '../../definition/extern-key.ts';
import { mapValueOf, type Value } from '../../definition/values.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import { type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { arrayOf, int, resultOptional } from '../native-values.ts';
import { checkedIndex } from './positions.ts';

const keyType = parameterKey('K');
const valueType = parameterKey('V');
const map = namedKey(qualifiedName(wellKnown.map), keyType, valueType);

/** An entry as the `(key, value)` tuple a program sees. */
const entryTuple = ([key, value]: readonly [Value, Value]): Value => ({
  kind: 'tuple',
  elements: [key, value],
});

export const mapNatives: Natives<NativeContext> = {
  [preludeKey('size', map)]: ([m]) => BigInt(mapValueOf(m).entries.length),
  [preludeKey('get', map, keyType)]: ([m, k], context) =>
    resultOptional(context, entryValue(mapValueOf(m), k ?? null)),
  [preludeKey('has', map, keyType)]: ([m, k]) =>
    entryPosition(mapValueOf(m), k ?? null) !== undefined,
  [preludeKey('delete', referenceKey(map), keyType)]: ([m, k], context) => {
    const before = mapValueOf(m);
    const after = withoutEntry(before, k ?? null);
    context.write(0, after);
    return after !== before;
  },
  [preludeKey('keys', map)]: ([m]) => arrayOf(mapValueOf(m).entries.map(([k]) => k)),
  [preludeKey('values', map)]: ([m]) => arrayOf(mapValueOf(m).entries.map(([, v]) => v)),
  [preludeKey('entries', map)]: ([m]) => arrayOf(mapValueOf(m).entries.map(entryTuple)),
  [preludeKey('index', map, keyType)]: ([m, k]) => {
    const found = entryValue(mapValueOf(m), k ?? null);
    if (found === undefined) {
      throw new Panic('The map holds no such key.');
    }
    return found;
  },
  [preludeKey('setIndex', referenceKey(map), keyType, valueType)]: ([m, k, v], context) => {
    context.write(0, withEntry(mapValueOf(m), k ?? null, v ?? null));
    return null;
  },
  [preludeKey('_entryAt', map, primitiveKey('int'))]: ([m, position]) => {
    const { entries } = mapValueOf(m);
    return entryTuple(
      entries[checkedIndex(int(position), entries.length, 'a map')] ?? [null, null],
    );
  },
  [preludeKey('Map.default')]: () => ({ kind: 'map', entries: [] }),
};
