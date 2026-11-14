/**
 * Formatting getters (§3.1): `get` printed between `fn` and the name, after the head's marks, and
 * reparsing to the tree printed.
 */

import { describe, expect, it } from 'vitest';
import { lines, roundTripOf } from './format.test-kit.ts';
import { formatText } from './format.ts';

describe('getters', () => {
  it.each([
    ['generic and marked', lines('live fn get first<T>(self: Box<T>) -> T: self.items[0]')],
    ['with a named mark', lines('M fn get first<M in Persistence>(self: Box) -> Int: 1')],
    ['named get', lines('fn get get(self: Box) -> Int: self.n')],
    ['beside a function named get', lines('fn get(self: Box) -> Int: self.n')],
  ])('prints one %s as written', (_title, text) => {
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('keeps `get` where the head breaks', () => {
    const text = lines(
      'fn get summary(self: Box) -> String:',
      '  `${self.first} and ${self.second} and ${self.third} and ${self.fourth} and ${self.fifth}`',
    );
    expect(formatText(text)).toBe(text);
  });
});
