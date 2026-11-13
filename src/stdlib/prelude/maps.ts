/**
 * The prelude's natives for maps (§3.8, §3.9, §3.10): reading, `&self` methods and indexing. Keys
 * are found by the built-in `==` (definition/values/equality.ts). A map is a value, so a method
 * taking `&self` changes it through its context, in place only when nothing else holds it.
 */

import { parameterKey, referenceKey } from '../../definition/extern-key.ts';
import { entryPosition, entryValue } from '../../definition/values/equality.ts';
import { mapValueOf, type Value } from '../../definition/values/values.ts';
import { wellKnown } from '../../foundation/language/well-known/index.ts';
import { type Native, type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { checkedIndex } from '../positions.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';
import { arrayOf, int } from '../values/arguments.ts';
import { resultOptional } from '../values/results.ts';

const keyType = parameterKey('K');
const valueType = parameterKey('V');
const map = knownTypeKey(wellKnown.map, keyType, valueType);

/** An entry as the `(key, value)` tuple a program sees. */
const entryTuple = ([key, value]: readonly [Value, Value]): Value => ({
  kind: 'tuple',
  elements: [key, value],
});

/** `has`, and `includes` for `in` (§3.9): whether a map has an entry for a key. */
const hasKey: Native<NativeContext> = ([m, k]) =>
  entryPosition(mapValueOf(m), k ?? null) !== undefined;

export const mapNatives = (keys: NativeKeys): Natives<NativeContext> => ({
  [keys.of('size', map)]: ([m]) => BigInt(mapValueOf(m).entries.length),
  [keys.of('get', map, keyType)]: ([m, k], context) =>
    resultOptional(context, entryValue(mapValueOf(m), k ?? null)),
  [keys.of('has', map, keyType)]: hasKey,
  [keys.of('includes', map, keyType)]: hasKey,
  [keys.of('delete', referenceKey(map), keyType)]: ([, k], context) =>
    context.changes(0).deleteEntry(k ?? null),
  [keys.of('keys', map)]: ([m]) => arrayOf(mapValueOf(m).entries.map(([k]) => k)),
  [keys.of('values', map)]: ([m]) => arrayOf(mapValueOf(m).entries.map(([, v]) => v)),
  [keys.of('entries', map)]: ([m]) => arrayOf(mapValueOf(m).entries.map(entryTuple)),
  [keys.of('index', map, keyType)]: ([m, k]) => {
    const found = entryValue(mapValueOf(m), k ?? null);
    if (found === undefined) {
      throw new Panic('The map holds no such key.');
    }
    return found;
  },
  [keys.of('setIndex', referenceKey(map), keyType, valueType)]: ([, k, v], context) => {
    context.changes(0).setEntry(k ?? null, v ?? null);
    return null;
  },
  [keys.of('_entryAt', map, 'Int')]: ([m, position]) => {
    const { entries } = mapValueOf(m);
    return entryTuple(
      entries[checkedIndex(int(position), entries.length, 'a map')] ?? [null, null],
    );
  },
  [keys.ofStatic(wellKnown.map.name, 'default')]: () => ({ kind: 'map', entries: [] }),
});
