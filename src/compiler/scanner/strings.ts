/**
 * String literals and the escapes every literal with escapes shares (spec §2).
 *
 * `"…"` and `'…'` mean the same thing; each may hold the other quote unescaped. Strings are
 * single-line: a line break ends an unterminated string right there. A missing closing quote then
 * swallows at most the rest of its line, and the next line still scans normally. Templates span
 * lines (templates.ts) and take the same escapes.
 *
 * Only the escapes the spec lists are valid. An invalid escape keeps its character in the value, so
 * the decoded text stays close to what the author wrote.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { codePointWidth } from '../../foundation/text/code-points.ts';
import { lineBreakLength } from '../../foundation/text/line-map.ts';
import { isHexDigit } from './characters.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import type { ScannedLexeme } from './lexeme.ts';

/** Decoded text and where its source ends. */
interface Decoded {
  readonly end: number;
  readonly value: string;
}

const simpleEscapes: ReadonlyMap<string, string> = new Map([
  ['n', '\n'],
  ['t', '\t'],
  ['\\', '\\'],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['$', '$'],
]);

/** The valid escapes, as the invalid-escape diagnostic lists them. */
export const validEscapes = [...simpleEscapes.keys(), 'u{…}']
  .map((escaped) => `\\${escaped}`)
  .join(', ');

const maxUnicodeEscapeDigits = 6;
const maxCodePoint = 0x10_ff_ff;
const surrogateFirst = 0xd8_00;
const surrogateLast = 0xdf_ff;

/** Scans the string literal whose opening quote is at `start`. */
export function scanString(text: string, start: number, diagnostics: Diagnostic[]): ScannedLexeme {
  const quote = text[start];
  const parts: string[] = [];
  let chunkStart = start + 1;
  let offset = chunkStart;
  while (offset < text.length && text[offset] !== quote && lineBreakLength(text, offset) === 0) {
    if (text[offset] === '\\') {
      parts.push(text.slice(chunkStart, offset));
      // A backslash ending the line leaves the string unterminated, which is reported once, below.
      const decoded = scanEscape(text, offset, diagnostics) ?? { end: offset + 1, value: '' };
      parts.push(decoded.value);
      offset = decoded.end;
      chunkStart = offset;
    } else {
      offset += 1;
    }
  }
  parts.push(text.slice(chunkStart, offset));
  const token = { kind: 'string', value: parts.join('') } as const;
  if (text[offset] === quote) {
    return { end: offset + 1, token };
  }
  diagnostics.push(scannerDiagnostics.unterminatedString({ start, end: offset }));
  return { end: offset, token };
}

/**
 * Decodes the escape whose backslash is at `backslash`; undefined for a backslash ending a line or
 * the text, which escapes nothing, so its literal decides what that means.
 */
export function scanEscape(
  text: string,
  backslash: number,
  diagnostics: Diagnostic[],
): Decoded | undefined {
  const escaped = text[backslash + 1];
  const simple = escaped === undefined ? undefined : simpleEscapes.get(escaped);
  if (simple !== undefined) {
    return { end: backslash + 2, value: simple };
  }
  if (escaped === 'u') {
    return scanUnicodeEscape(text, backslash, diagnostics);
  }
  if (endsLine(text, backslash + 1)) {
    return undefined;
  }
  const end = backslash + 1 + codePointWidth(text, backslash + 1);
  const sequence = text.slice(backslash, end);
  diagnostics.push(
    scannerDiagnostics.invalidEscape({ start: backslash, end }, sequence, validEscapes),
  );
  return { end, value: sequence.slice(1) };
}

/** Decodes `\u{…}`; a malformed one yields an empty value and one diagnostic over what it read. */
function scanUnicodeEscape(text: string, backslash: number, diagnostics: Diagnostic[]): Decoded {
  const open = backslash + 2;
  if (text[open] !== '{') {
    diagnostics.push(scannerDiagnostics.invalidUnicodeEscape({ start: backslash, end: open }));
    return { end: open, value: '' };
  }
  let digitsEnd = open + 1;
  while (isHexDigit(text[digitsEnd])) {
    digitsEnd += 1;
  }
  const closed = text[digitsEnd] === '}';
  const end = closed ? digitsEnd + 1 : digitsEnd;
  const digitCount = digitsEnd - open - 1;
  const codePoint = Number.parseInt(text.slice(open + 1, digitsEnd), 16);
  const isScalar =
    codePoint <= maxCodePoint && (codePoint < surrogateFirst || codePoint > surrogateLast);
  if (!closed || digitCount === 0 || digitCount > maxUnicodeEscapeDigits || !isScalar) {
    diagnostics.push(scannerDiagnostics.invalidUnicodeEscape({ start: backslash, end }));
    return { end, value: '' };
  }
  return { end, value: String.fromCodePoint(codePoint) };
}

/** Whether a line break or the end of the text stands at `offset`. */
function endsLine(text: string, offset: number): boolean {
  return offset >= text.length || lineBreakLength(text, offset) > 0;
}
