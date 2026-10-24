/**
 * The scanner's diagnostics, codes 1000–1999.
 *
 * Every scanner error still yields a token of the intended kind, with a best-effort value, so the
 * parser sees the structure the author meant and reports no cascade of follow-up errors.
 */

import { defineDiagnostics } from '../../diagnostics/catalog.ts';

export const scannerDiagnostics = defineDiagnostics('scanner', {
  unexpectedCharacter: {
    code: 1001,
    message: (text: string) => `Unexpected character '${text}'.`,
  },
  unterminatedString: {
    code: 1002,
    message: () => 'Unterminated string literal: strings end on the line they start.',
  },
  invalidEscape: {
    code: 1003,
    message: (sequence: string, validEscapes: string) =>
      `Invalid escape sequence '${sequence}'. Valid escapes are ${validEscapes}.`,
  },
  invalidUnicodeEscape: {
    code: 1004,
    message: () => 'A \\u{…} escape takes 1 to 6 hex digits naming a Unicode scalar value.',
  },
  misplacedSeparator: {
    code: 1005,
    message: () => "A numeric separator '_' must stand between two digits.",
  },
  missingDigits: {
    code: 1006,
    message: (prefix: string) => `Expected digits after '${prefix}'.`,
  },
  invalidDigit: {
    code: 1007,
    message: (digit: string, base: string) => `'${digit}' is not a digit of a ${base} literal.`,
  },
  invalidNumericSuffix: {
    code: 1008,
    message: (suffix: string) =>
      `Unknown suffix '${suffix}' on a number. Durations take ms, s, m, h or d.`,
  },
  fractionalDuration: {
    code: 1009,
    message: () => 'A duration takes an integer magnitude, as in 90m rather than 1.5h.',
  },
  tabIndentation: {
    code: 1010,
    message: () => 'Indentation must use spaces, not tabs.',
  },
});
