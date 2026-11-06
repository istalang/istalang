/**
 * String literals (spec §2).
 *
 * Decoding is checked by round trip: any text, written as a literal with a random choice of
 * escapes, must decode back to itself. That covers both quotes, every escape, astral characters
 * and the characters a literal can't hold raw (its own quote, line breaks).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import { kindsAndTexts, scanMalformed, scannedPast, scanText, soleToken } from './scan.test-kit.ts';

const { invalidEscape, invalidUnicodeEscape, unterminatedString } = scannerDiagnostics;

const namedEscapes: Readonly<Record<string, string>> = {
  '\n': '\\n',
  '\t': '\\t',
  '\\': '\\\\',
  '"': '\\"',
  "'": "\\'",
  '`': '\\`',
  $: '\\$',
};

/** Writes `value` as a string literal, escaping what must be and, by choice, other characters. */
function literalOf(value: string, quote: string, escapeByCodePoint: readonly boolean[]): string {
  const body = [...value].map((char, index) => {
    const named = namedEscapes[char];
    const mustEscape = char === quote || char === '\r' || named !== undefined;
    if (escapeByCodePoint[index] || (mustEscape && named === undefined)) {
      return `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`;
    }
    return mustEscape ? named : char;
  });
  return quote + body.join('') + quote;
}

describe('valid strings', () => {
  it.each([
    ['"text"', 'text'],
    ["'text'", 'text'],
    ['""', ''],
    ['"it\'s"', "it's"],
    ['\'say "hi"\'', 'say "hi"'],
    ['"a\\nb\\tc"', 'a\nb\tc'],
    ['"\\\\ \\" \\\'"', '\\ " \''],
    ['"\\u{41}\\u{1F600}"', 'A😀'],
    ['"\\u{10FFFF}"', String.fromCodePoint(0x10_ff_ff)],
    ['"# not a comment"', '# not a comment'],
    ['"emoji 😀 and €"', 'emoji 😀 and €'],
  ])('decodes %s', (text, value) => {
    expect(soleToken(text)).toMatchObject({ kind: 'string', value });
  });

  it('decodes any text written with any mix of escapes', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 60 }),
        fc.constantFrom('"', "'"),
        fc.array(fc.boolean(), { maxLength: 60 }),
        (value, quote, escapeByCodePoint) => {
          const text = literalOf(value, quote, escapeByCodePoint);
          expect(soleToken(text)).toMatchObject({ kind: 'string', value });
        },
      ),
    );
  });
});

describe('malformed strings', () => {
  it.each([
    ['"open', unterminatedString.code, '"open'],
    ["'open", unterminatedString.code, "'open"],
    ['"ends in backslash\\', unterminatedString.code, '"ends in backslash\\'],
    ['"\\q"', invalidEscape.code, '\\q'],
    ['"\\r"', invalidEscape.code, '\\r'],
    ['"\\0"', invalidEscape.code, '\\0'],
    ['"\\😀"', invalidEscape.code, '\\😀'],
    ['"\\u41"', invalidUnicodeEscape.code, '\\u'],
    ['"\\u{}"', invalidUnicodeEscape.code, '\\u{}'],
    ['"\\u{1234567}"', invalidUnicodeEscape.code, '\\u{1234567}'],
    ['"\\u{110000}"', invalidUnicodeEscape.code, '\\u{110000}'],
    ['"\\u{D800}"', invalidUnicodeEscape.code, '\\u{D800}'],
    ['"\\u{41"', invalidUnicodeEscape.code, '\\u{41'],
  ])('reports %s once and keeps scanning', (input, code, spanText) => {
    expect(scanMalformed(input)).toEqual(scannedPast(reportedOnce(code, spanText)));
  });

  it.each(['\n', '\r\n', '\r'])('ends an unterminated string at the line break %j', (lineBreak) => {
    expect(kindsAndTexts(scanText(`"open${lineBreak}x`))).toEqual([
      ['string', '"open'],
      ['identifier', 'x'],
    ]);
  });

  it('keeps the escaped character of an invalid escape in the value', () => {
    expect(scanText('"a\\qb"').tokens[0]).toMatchObject({ kind: 'string', value: 'aqb' });
  });

  it('lists the valid escapes in its message', () => {
    const [diagnostic] = scanText('"\\q"').diagnostics;
    expect(diagnostic?.message).toBe(
      "Invalid escape sequence '\\q'. Valid escapes are \\n, \\t, \\\\, \\\", \\', \\`, \\$, \\u{…}.",
    );
  });
});
