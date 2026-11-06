/**
 * The prelude's natives for maps (§3.8, §3.9, §3.10): reading, `&self` methods and indexing. Keys
 * are found by the built-in `==` (definition/values/equality.ts), and a map is an immutable value,
 * so a method taking `&self` builds the changed map and writes it back through its context.
 */

import { parameterKey, referenceKey } from '../../definition/extern-key.ts';
import {
  entryPosition,
  entryValue,
  withEntry,
  withoutEntry,
} from '../../definition/values/equality.ts';
import { mapValueOf, type Value } from '../../definition/values/values.ts';
import { wellKnown } from '../../language/well-known.ts';
import { type Native, type NativeContext, type Natives, Panic } from '../../runtime/natives.ts';
import { arrayOf, int, resultOptional } from '../native-values.ts';
import { checkedIndex } from '../positions.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

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
  [keys.of('delete', referenceKey(map), keyType)]: ([m, k], context) => {
    const before = mapValueOf(m);
    const after = withoutEntry(before, k ?? null);
    context.write(0, after);
    return after !== before;
  },
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
  [keys.of('setIndex', referenceKey(map), keyType, valueType)]: ([m, k, v], context) => {
    context.write(0, withEntry(mapValueOf(m), k ?? null, v ?? null));
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
