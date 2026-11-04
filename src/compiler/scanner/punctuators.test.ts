/**
 * Punctuators (spec §2–§4): each one alone, any sequence of them, and longest-match cases where a
 * shorter punctuator is a prefix of a longer one.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { punctuators } from '../syntax/tokens.ts';
import { kindsAndTexts, scanText, soleToken } from './scan.test-kit.ts';

describe('punctuators', () => {
  it.each(punctuators)('scans %s alone', (punctuator) => {
    expect(soleToken(punctuator)?.kind).toBe(punctuator);
  });

  it('separates any sequence of punctuators written with spaces', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...punctuators), { maxLength: 30 }), (sequence) => {
        const scanned = scanText(sequence.join(' '));
        expect(scanned.diagnostics).toEqual([]);
        expect(kindsAndTexts(scanned).map(([kind]) => kind)).toEqual(sequence);
      }),
    );
  });

  it.each([
    ['a?.b', ['identifier', '?.', 'identifier']],
    ['a??b', ['identifier', '??', 'identifier']],
    ['f(x)?', ['identifier', '(', 'identifier', ')', '?']],
    ['[...xs]', ['[', '...', 'identifier', ']']],
    ['x //= 2', ['identifier', '//=', 'integer']],
    ['a//b', ['identifier', '//', 'identifier']],
    ['fn f() -> Int', ['fn', 'identifier', '(', ')', '->', 'identifier']],
    ['u->name', ['identifier', '->', 'identifier']],
    ['u?->name', ['identifier', '?->', 'identifier']],
    ['r? ->name', ['identifier', '?', '->', 'identifier']],
    ['[:]', ['[', ':', ']']],
    ['@JsonSkip', ['@', 'identifier']],
  ])('reads %s by longest match', (text, kinds) => {
    expect(kindsAndTexts(scanText(text)).map(([kind]) => kind)).toEqual(kinds);
  });

  it('scans >> as one shift, which the parser splits where it closes type arguments', () => {
    expect(kindsAndTexts(scanText('Array<Array<Int>>')).map(([kind]) => kind)).toEqual([
      'identifier',
      '<',
      'identifier',
      '<',
      'identifier',
      '>>',
    ]);
  });
});
