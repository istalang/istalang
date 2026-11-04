import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addToGroup } from './groups.ts';

describe('addToGroup', () => {
  it('groups items one at a time as Map.groupBy groups them whole', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer())), (items) => {
        const groups = new Map<number, (readonly [number, number])[]>();
        for (const item of items) {
          addToGroup(groups, item[0], item);
        }
        expect(groups).toEqual(Map.groupBy(items, ([key]) => key));
      }),
    );
  });
});
