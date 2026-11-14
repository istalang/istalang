/**
 * The JSON an instance wrote values as, against its changes in place (written-json.ts,
 * in-place.ts): a value changed in place is written again, still changed in place, and no part of
 * a JSON kept is ever changed in place.
 */

import { describe, expect, it } from 'vitest';
import type { TypeReference } from '../../definition/tables/types.ts';
import type { CompositeValue, Value } from '../../definition/values/values.ts';
import { type Held, nothingHeld } from '../snapshot/holdings.ts';
import { HolderWrites } from './holder-writes.ts';

const int: TypeReference = { kind: 'primitive', name: 'Int' };
const text: TypeReference = { kind: 'primitive', name: 'String' };

/** An instance's holder writes, counting nothing on its heap. */
function instanceWrites(): HolderWrites {
  return new HolderWrites(() => false);
}

/** `value` held by one more holder, as a register is; what to report as it lets go. */
function held(writes: HolderWrites, value: Value): Held {
  const holding: Held = { values: [value], holds: [] };
  writes.changed(nothingHeld, holding);
  return holding;
}

function madeArray(writes: HolderWrites, elements: readonly Value[]): CompositeValue {
  return writes.values.made({ kind: 'array', elements: [...elements] });
}

describe('the JSON an instance wrote a value as', () => {
  it('is given again per type until the value changes', () => {
    const writes = instanceWrites();
    const value = madeArray(writes, [1n]);
    const json = madeArray(writes, []);
    writes.written.remember(value, int, json);
    expect(writes.written.of(value, int)).toBe(json);
    expect(writes.written.of(value, text)).toBeUndefined();
    expect(writes.written.of(1n, int)).toBeUndefined();
  });

  it('is forgotten as its value changes in place, which stays in place', () => {
    const writes = instanceWrites();
    const value = madeArray(writes, [1n]);
    held(writes, value);
    writes.written.remember(value, int, madeArray(writes, []));
    expect(writes.values.appended(value, [2n])).toBe(value);
    expect(writes.written.of(value, int)).toBeUndefined();
  });

  it('is forgotten for every value holding a part changed in place', () => {
    const writes = instanceWrites();
    const inner = madeArray(writes, [1n]);
    const outer = madeArray(writes, [inner]);
    held(writes, outer);
    writes.written.remember(outer, int, madeArray(writes, []));
    writes.written.remember(inner, int, madeArray(writes, []));
    expect(writes.values.withPart(outer, [0, 0], 2n)).toBe(outer);
    expect(writes.written.of(outer, int)).toBeUndefined();
    expect(writes.written.of(inner, int)).toBeUndefined();
  });

  it('never has a part changed in place, even once code lets go of it', () => {
    const writes = instanceWrites();
    const part = madeArray(writes, [1n]);
    const json = madeArray(writes, [part]);
    const register = held(writes, json);
    held(writes, part);
    writes.written.remember(madeArray(writes, []), int, json);
    writes.changed(register, nothingHeld);
    const changed = writes.values.appended(part, [2n]);
    expect(changed).not.toBe(part);
    expect(part).toEqual({ kind: 'array', elements: [1n] });
  });
});
