/**
 * Drawing a uniform integer below a bound (natives.ts `uniformBelow`), from the runtime's random
 * source: it stays below any bound, however many draws the bound's bits take, and reaches every
 * value of a small one.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { drawBytes, drawOf, seedOf } from '../../runtime/scheduler/random-source.ts';
import { uniformBelow } from './natives.ts';

/** Draws from the source seeded with `seed`, counting from the first. */
function drawsFrom(seed: string): () => Uint8Array {
  let index = 0;
  return () => {
    const draw = drawOf(seed, index);
    index += 1;
    return draw;
  };
}

const seedArbitrary = fc.uint8Array({ minLength: drawBytes, maxLength: drawBytes }).map(seedOf);

describe('uniformBelow', () => {
  it('stays from 0 up to its bound, from one bit to several draws wide', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 2n ** 600n }), seedArbitrary, (bound, seed) => {
        const value = uniformBelow(bound, drawsFrom(seed));
        expect(value >= 0n && value < bound).toBe(true);
      }),
    );
  });

  it('reaches every value of a small bound', () => {
    const draw = drawsFrom(seedOf(new Uint8Array(drawBytes)));
    const seen = new Set(Array.from({ length: 300 }, () => uniformBelow(6n, draw)));
    expect(seen).toEqual(new Set([0n, 1n, 2n, 3n, 4n, 5n]));
  });
});
