/**
 * Number and duration literals (spec §2).
 *
 * A number's extent is decided by the characters alone, never by what they mean, so a malformed
 * literal is still one token. After its digits, every identifier character is read as a suffix:
 * `0b102` is one bad binary literal and `5days` one bad duration, rather than a number followed by
 * a stray name. A suffix that names a unit makes a duration.
 *
 * A fraction needs a digit after the dot, so `2.toString()` and `0..10` scan as an integer followed by
 * `.` or `..`. Radix prefixes are lowercase only (`0x`, `0b`), to keep one spelling. Hex digits may
 * be in either case.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import {
  millisecondsPerDay,
  millisecondsPerHour,
  millisecondsPerMinute,
  millisecondsPerSecond,
} from '../../foundation/language/time-units.ts';
import { identifierRunEnd, isDecimalDigit, isHexDigit } from './characters.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import type { ScannedLexeme } from './lexeme.ts';

const millisecondsPerUnit: ReadonlyMap<string, bigint> = new Map([
  ['ms', 1n],
  ['s', millisecondsPerSecond],
  ['m', millisecondsPerMinute],
  ['h', millisecondsPerHour],
  ['d', millisecondsPerDay],
]);

const separatorRuns = /_+/gu;

interface Radix {
  readonly prefix: string;
  readonly name: string;
  readonly isDigit: (char: string) => boolean;
}

const radixes: readonly Radix[] = [
  { prefix: '0x', name: 'hexadecimal', isDigit: isHexDigit },
  { prefix: '0b', name: 'binary', isDigit: (char) => char === '0' || char === '1' },
];

/** Scans the number literal starting at `start`, which must be a decimal digit. */
export function scanNumber(text: string, start: number, diagnostics: Diagnostic[]): ScannedLexeme {
  const radix = radixes.find((candidate) => text.startsWith(candidate.prefix, start));
  return radix === undefined
    ? scanDecimal(text, start, diagnostics)
    : scanRadixInteger(text, start, radix, diagnostics);
}

function scanRadixInteger(
  text: string,
  start: number,
  radix: Radix,
  diagnostics: Diagnostic[],
): ScannedLexeme {
  const digitsStart = start + radix.prefix.length;
  const end = identifierRunEnd(text, digitsStart);
  const run = text.slice(digitsStart, end);
  const digits = [...run].filter(radix.isDigit).join('');
  if (digits === '') {
    diagnostics.push(scannerDiagnostics.missingDigits({ start, end }, radix.prefix));
    return { end, token: { kind: 'integer', value: 0n } };
  }
  reportMisplacedSeparators(text, digitsStart, end, diagnostics);
  const invalidAt = [...run].findIndex((char) => char !== '_' && !radix.isDigit(char));
  if (invalidAt >= 0) {
    const offset = digitsStart + invalidAt;
    const span = { start: offset, end: offset + 1 };
    diagnostics.push(scannerDiagnostics.invalidDigit(span, run.charAt(invalidAt), radix.name));
  }
  return { end, token: { kind: 'integer', value: BigInt(radix.prefix + digits) } };
}

function scanDecimal(text: string, start: number, diagnostics: Diagnostic[]): ScannedLexeme {
  const integer = { start, end: digitGroupEnd(text, start) };
  const groups: DigitGroup[] = [integer];
  const fraction = text[integer.end] === '.' ? digitGroupAt(text, integer.end + 1) : undefined;
  if (fraction !== undefined) {
    groups.push(fraction);
  }
  const afterFraction = fraction?.end ?? integer.end;
  const exponent = exponentGroupAt(text, afterFraction);
  if (exponent !== undefined) {
    groups.push(exponent);
  }
  const numberEnd = exponent?.end ?? afterFraction;
  for (const group of groups) {
    reportMisplacedSeparators(text, group.start, group.end, diagnostics);
  }

  const numberText = text.slice(start, numberEnd).replaceAll('_', '');
  const isFloat = fraction !== undefined || exponent !== undefined;
  const suffixEnd = identifierRunEnd(text, numberEnd);
  const suffix = text.slice(numberEnd, suffixEnd);
  const unit = millisecondsPerUnit.get(suffix);
  if (suffix !== '' && unit === undefined) {
    diagnostics.push(
      scannerDiagnostics.invalidNumericSuffix({ start: numberEnd, end: suffixEnd }, suffix),
    );
  }
  if (unit === undefined) {
    const token = isFloat
      ? ({ kind: 'float', value: Number(numberText) } as const)
      : ({ kind: 'integer', value: BigInt(numberText) } as const);
    return { end: suffixEnd, token };
  }
  if (isFloat) {
    diagnostics.push(scannerDiagnostics.fractionalDuration({ start, end: suffixEnd }));
    return { end: suffixEnd, token: { kind: 'duration', value: 0n } };
  }
  return { end: suffixEnd, token: { kind: 'duration', value: BigInt(numberText) * unit } };
}

interface DigitGroup {
  readonly start: number;
  readonly end: number;
}

/** A run of digits and separators, if a digit starts at `offset`. */
function digitGroupAt(text: string, offset: number): DigitGroup | undefined {
  return isDecimalDigit(text[offset])
    ? { start: offset, end: digitGroupEnd(text, offset) }
    : undefined;
}

/** The digits of `e5`, `E+5` or `e-5` starting at `offset`; a bare `e` is not an exponent. */
function exponentGroupAt(text: string, offset: number): DigitGroup | undefined {
  if (text[offset] !== 'e' && text[offset] !== 'E') {
    return undefined;
  }
  const sign = text[offset + 1] === '+' || text[offset + 1] === '-' ? 1 : 0;
  return digitGroupAt(text, offset + 1 + sign);
}

function digitGroupEnd(text: string, offset: number): number {
  let end = offset;
  while (isDecimalDigit(text[end]) || text[end] === '_') {
    end += 1;
  }
  return end;
}

/** Reports each run of `_` in [start, end) that is doubled or touches either edge. */
function reportMisplacedSeparators(
  text: string,
  start: number,
  end: number,
  diagnostics: Diagnostic[],
): void {
  for (const run of text.slice(start, end).matchAll(separatorRuns)) {
    const runStart = start + run.index;
    const runEnd = runStart + run[0].length;
    if (runStart === start || runEnd === end || run[0].length > 1) {
      diagnostics.push(scannerDiagnostics.misplacedSeparator({ start: runStart, end: runEnd }));
    }
  }
}
