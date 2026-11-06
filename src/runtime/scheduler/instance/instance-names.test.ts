/** Spawned instances' names (§9), and the ancestors a name says an instance has (§10). */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ancestorsOf, spawnedName, spawnedSeparator } from './instance-names.ts';

describe('instance names', () => {
  it('name each spawned instance after its parent, nearest ancestor first', () => {
    expect(ancestorsOf('test')).toEqual([]);
    expect(ancestorsOf(spawnedName(spawnedName('test', 2), 1))).toEqual(['test/2', 'test']);
  });

  it("give back the instances a spawned instance's name was made from, nearest first", () => {
    const hostName = fc.string({ minLength: 1 }).filter((name) => !name.includes(spawnedSeparator));
    fc.assert(
      fc.property(hostName, fc.array(fc.nat({ max: 99 }), { maxLength: 4 }), (host, counts) => {
        const chain = [host];
        for (const count of counts) {
          chain.push(spawnedName(chain.at(-1) ?? host, count + 1));
        }
        expect(ancestorsOf(chain.at(-1) ?? host)).toEqual(chain.slice(0, -1).toReversed());
      }),
    );
  });
});
