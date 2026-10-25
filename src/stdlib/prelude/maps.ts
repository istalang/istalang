/**
 * The prelude's natives for maps (§3.8, §3.9, §3.10): reading, `&self` methods and indexing. Keys
 * are found by the built-in `==` (definition/equality.ts), and a map is an immutable value, so
 * a method taking `&self` builds the changed map and writes it back through its context.
 */

import { entryPosition, entryValue, withEntry, withoutEntry } from '../../definition/equality.ts';
import { namedKey, nativeKey, parameterKey, referenceKey } from '../../definition/extern-key.ts';
import type { Value } from '../../definition/values.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import { type Natives, Panic } from '../../runtime/natives.ts';
import { arrayOf, mapOfArgument, resultOptional } from '../native-values.ts';
import { preludeName } from '../stdlib-loader.ts';

const keyType = parameterKey('K');
const valueType = parameterKey('V');
const map = namedKey(qualifiedName(wellKnown.map), keyType, valueType);

const key = (name: string, ...parameters: Parameters<typeof nativeKey>[2][]) =>
  nativeKey(preludeName, name, ...parameters);

/** `m`'s entries as `(key, value)` tuples, in the map's order. */
const entriesOf = (m: Value | undefined): Value =>
  arrayOf(mapOfArgument(m).entries.map(([k, v]) => ({ kind: 'tuple', elements: [k, v] })));

export const mapNatives: Natives = {
  [key('size', map)]: ([m]) => BigInt(mapOfArgument(m).entries.length),
  [key('get', map, keyType)]: ([m, k], context) =>
    resultOptional(context, entryValue(mapOfArgument(m), k ?? null)),
  [key('has', map, keyType)]: ([m, k]) => entryPosition(mapOfArgument(m), k ?? null) !== undefined,
  [key('delete', referenceKey(map), keyType)]: ([m, k], context) => {
    const before = mapOfArgument(m);
    const after = withoutEntry(before, k ?? null);
    context.write(0, after);
    return after !== before;
  },
  [key('keys', map)]: ([m]) => arrayOf(mapOfArgument(m).entries.map(([k]) => k)),
  [key('values', map)]: ([m]) => arrayOf(mapOfArgument(m).entries.map(([, v]) => v)),
  [key('entries', map)]: ([m]) => entriesOf(m),
  [key('index', map, keyType)]: ([m, k]) => {
    const found = entryValue(mapOfArgument(m), k ?? null);
    if (found === undefined) {
      throw new Panic('The map holds no such key.');
    }
    return found;
  },
  [key('setIndex', referenceKey(map), keyType, valueType)]: ([m, k, v], context) => {
    context.write(0, withEntry(mapOfArgument(m), k ?? null, v ?? null));
    return null;
  },
  [key('iterate', map)]: ([m]) => entriesOf(m),
  [key('Map.default')]: () => ({ kind: 'map', entries: [] }),
};
