/**
 * Formatting context constants (§7.1): printed as written, with or without a type, and reparsing
 * to the tree printed.
 */

import { describe, expect, it } from 'vitest';
import { lines, roundTripOf } from './format.test-kit.ts';
import { formatText } from './format.ts';

describe('context constants', () => {
  it('prints each as written', () => {
    const text = lines(
      'ista const verdicts = Inbox.create<Verdict>()',
      'ista const spent: Shared<Int> = new Shared{value: 0}',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });
});
