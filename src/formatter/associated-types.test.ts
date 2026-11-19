/**
 * Formatting associated types bounded to members and those an extern struct declares (§17.2,
 * §8.2): printed in the declaration's members, and reparsing to the tree printed.
 */

import { describe, expect, it } from 'vitest';
import { lines, roundTripOf } from './format.test-kit.ts';
import { formatText } from './format.ts';

describe('associated types bounded to members, and declared by extern structs', () => {
  it('prints each among its members, in braces when they fit a compressed line', () => {
    const text = lines(
      'trait Awaits<T>:',
      '  type Mode in Persistence',
      '  Self.Mode fn wait(self: Self)',
      '',
      'extern shared struct Ticket<K in Persistence> { type Mode = K }',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });
});
