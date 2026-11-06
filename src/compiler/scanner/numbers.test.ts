/**
 * Number and duration literals (spec §2).
 *
 * Values are checked by round trip over generated literals in every base, with random separator
 * placement and digit case, so the tests cover the encodings rather than a few hand-picked values.
 * Floats are generated from JavaScript's own printing, which is the shortest form that round-trips.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import { kindsAndTexts, scanMalformed, scannedPast, scanText, soleToken } from './scan.test-kit.ts';

const {
  fractionalDuration,
  invalidDigit,
  invalidNumericSuffix,
  misplacedSeparator,
  missingDigits,
} = scannerDiagnostics;

const floatNotation = /[.e]/u;
const millisecondsPerUnit = { ms: 1n, s: 1000n, m: 60_000n, h: 3_600_000n, d: 86_400_000n };

/** Inserts `_` between random digit pairs, never doubled and never at an edge. */
function withSeparators(digits: string, cuts: readonly boolean[]): string {
  return [...digits]
    .map((digit, index) => (index > 0 && cuts[index] ? `_${digit}` : digit))
    .join('');
}

describe('valid literals', () => {
  it.each([
    ['42', 'integer', 42n],
    ['0', 'integer', 0n],
    ['007', 'integer', 7n],
    ['1_000_000', 'integer', 1_000_000n],
    ['0x1F', 'integer', 31n],
    ['0xff_FF', 'integer', 65_535n],
    ['0b1010', 'integer', 10n],
    ['3.14', 'float', 3.14],
    ['1e9', 'float', 1e9],
    ['1E+9', 'float', 1e9],
    ['2.5e-3', 'float', 2.5e-3],
    ['500ms', 'duration', 500n],
    ['30s', 'duration', 30_000n],
    ['15m', 'duration', 900_000n],
    ['2h', 'duration', 7_200_000n],
    ['5d', 'duration', 432_000_000n],
    ['1_000ms', 'duration', 1000n],
  ])('scans %s as %s %s', (text, kind, value) => {
    expect(soleToken(text)).toMatchObject({ kind, value });
  });

  it('scans arbitrary-precision integers in every base', () => {
    const base = fc.constantFrom(
      { prefix: '', radix: 10 },
      { prefix: '0x', radix: 16 },
      { prefix: '0b', radix: 2 },
    );
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 40n }),
        base,
        fc.array(fc.boolean(), { maxLength: 200 }),
        fc.boolean(),
        (value, { prefix, radix }, cuts, upper) => {
          const digits = value.toString(radix);
          const text = prefix + withSeparators(upper ? digits.toUpperCase() : digits, cuts);
          expect(soleToken(text)).toMatchObject({ kind: 'integer', value });
        },
      ),
    );
  });

  it('scans every finite float printed by JavaScript', () => {
    const printed = fc
      .double({ min: 0, noNaN: true, noDefaultInfinity: true })
      .filter((value) => floatNotation.test(String(value)));
    fc.assert(
      fc.property(printed, (value) => {
        expect(soleToken(String(value))).toMatchObject({ kind: 'float', value });
      }),
    );
  });

  it('scans durations of any magnitude and unit', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.constantFrom(...Object.entries(millisecondsPerUnit)),
        (magnitude, [unit, milliseconds]) => {
          const token = soleToken(`${magnitude}${unit}`);
          expect(token).toMatchObject({ kind: 'duration', value: magnitude * milliseconds });
        },
      ),
    );
  });

  it.each([
    ['2.pow(10)', ['integer', '.', 'identifier', '(', 'integer', ')']],
    ['0..10', ['integer', '..', 'integer']],
    ['0..=10', ['integer', '..=', 'integer']],
    ['1.e5', ['integer', '.', 'identifier']],
    ['.5', ['.', 'integer']],
    ['-3', ['-', 'integer']],
  ])('splits %s without consuming the dot or sign', (text, kinds) => {
    const scanned = scanText(text);
    expect(scanned.diagnostics).toEqual([]);
    expect(kindsAndTexts(scanned).map(([kind]) => kind)).toEqual(kinds);
  });
});

describe('malformed literals', () => {
  it.each([
    ['1__000', misplacedSeparator.code, '__'],
    ['1_', misplacedSeparator.code, '_'],
    ['1_.5', misplacedSeparator.code, '_'],
    ['1e5_', misplacedSeparator.code, '_'],
    ['0x_1F', misplacedSeparator.code, '_'],
    ['0x', missingDigits.code, '0x'],
    ['0b_', missingDigits.code, '0b_'],
    ['0b102', invalidDigit.code, '2'],
    ['0x1G', invalidDigit.code, 'G'],
    ['0x10s', invalidDigit.code, 's'],
    ['5days', invalidNumericSuffix.code, 'days'],
    ['0X1F', invalidNumericSuffix.code, 'X1F'],
    ['0o17', invalidNumericSuffix.code, 'o17'],
    ['1e', invalidNumericSuffix.code, 'e'],
    ['12abc', invalidNumericSuffix.code, 'abc'],
    ['1.5h', fractionalDuration.code, '1.5h'],
    ['1e3s', fractionalDuration.code, '1e3s'],
  ])('reports %s once and keeps scanning', (input, code, spanText) => {
    expect(scanMalformed(input)).toEqual(scannedPast(reportedOnce(code, spanText)));
  });

  it('still yields one token of the intended kind', () => {
    expect(kindsAndTexts(scanText('1__0 0b12 5days 1.5h')).map(([kind]) => kind)).toEqual([
      'integer',
      'integer',
      'integer',
      'duration',
    ]);
  });
});
