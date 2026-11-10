/**
 * How JavaScript string and template literals spell their text (ECMA-262 §12.9.4, §12.9.6): reading
 * a literal's raw text into the text it means, with where each character's spelling starts, and
 * spelling new text for one kind of literal.
 *
 * Reading keeps, for every boundary of the text, the raw offset of the escape or character that
 * spells what follows it, so an edit of the text maps into the raw text one spelling at a time. An
 * escape spelling two UTF-16 units (`\u{1F600}`) leaves the boundary between them nowhere. A line
 * continuation spells nothing, so it goes with the character after it. Legacy octal escapes are
 * strict mode errors, so no module holds one; reading refuses them.
 *
 * Spelling escapes only what the literal's kind requires: the backslash, the literal's own quote,
 * and line breaks in a quoted string; in a template, a backtick, a carriage return (which a template
 * reads as a line feed) and `${`. Text spelled into a template next to a `$` or a `{` of the file's
 * could open a substitution across the seam, which no escape of the text alone prevents: that
 * spelling is refused, rather than escaping the file's own text.
 */

import { lineBreakLength } from '../../../../src/foundation/text/line-map.ts';

export type Quote = "'" | '"' | '`';

export interface Cooked {
  readonly text: string;
  /** The raw offset of each boundary of `text`, `text.length + 1` of them. */
  readonly offsets: readonly (number | undefined)[];
}

/** One spelling: what it means, and how many raw characters spell it. */
interface Unit {
  readonly text: string;
  readonly length: number;
}

const singleEscapes: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

const lineTerminators = new Set(['\n', '\r', '\u2028', '\u2029']);
const hexDigits = /^[\da-f]+$/iu;
const decimalDigit = /^\d$/u;
const hexRadix = 16;
const byteEscapeLength = 4;
const unitEscapeLength = 6;

/** The text `raw` spells in a `quote` literal; undefined if it holds an escape no module may. */
export function cook(raw: string, quote: Quote): Cooked | undefined {
  let text = '';
  const offsets: (number | undefined)[] = [];
  for (let offset = 0; offset < raw.length; ) {
    const unit = raw[offset] === '\\' ? escapeAt(raw, offset) : characterAt(raw, offset, quote);
    if (unit === undefined) {
      return undefined;
    }
    offsets.push(
      ...Array.from({ length: unit.text.length }, (_, index) => (index === 0 ? offset : undefined)),
    );
    text += unit.text;
    offset += unit.length;
  }
  offsets.push(raw.length);
  return { text, offsets };
}

/**
 * The character at `offset`; a template reads a carriage return, alone or before a line feed, as a
 * line feed.
 */
function characterAt(raw: string, offset: number, quote: Quote): Unit {
  const char = raw[offset] ?? '';
  if (quote === '`' && char === '\r') {
    return { text: '\n', length: raw[offset + 1] === '\n' ? 2 : 1 };
  }
  return { text: char, length: 1 };
}

/** The escape at `offset`, or undefined if it is a legacy octal one or malformed. */
function escapeAt(raw: string, offset: number): Unit | undefined {
  const char = raw[offset + 1] ?? '';
  const single = singleEscapes[char];
  if (single !== undefined) {
    return { text: single, length: 2 };
  }
  if (lineTerminators.has(char)) {
    return { text: '', length: 1 + Math.max(lineBreakLength(raw, offset + 1), 1) };
  }
  if (char === 'x') {
    return codeUnitEscape(raw, offset, byteEscapeLength);
  }
  if (char === 'u') {
    return raw[offset + 2] === '{'
      ? codePointEscape(raw, offset)
      : codeUnitEscape(raw, offset, unitEscapeLength);
  }
  if (char === '0' && !decimalDigit.test(raw[offset + 2] ?? '')) {
    return { text: '\0', length: 2 };
  }
  if (decimalDigit.test(char)) {
    return undefined;
  }
  const codePoint = String.fromCodePoint(raw.codePointAt(offset + 1) ?? 0);
  return { text: codePoint, length: 1 + codePoint.length };
}

/** `\xHH` or `\uHHHH`, `length` raw characters long. */
function codeUnitEscape(raw: string, offset: number, length: number): Unit | undefined {
  const digits = raw.slice(offset + 2, offset + length);
  return digits.length === length - 2 && hexDigits.test(digits)
    ? { text: String.fromCharCode(Number.parseInt(digits, hexRadix)), length }
    : undefined;
}

const codePointOpening = '\\u{';

/** `\u{H…}`. */
function codePointEscape(raw: string, offset: number): Unit | undefined {
  const digitsStart = offset + codePointOpening.length;
  const close = raw.indexOf('}', digitsStart);
  const digits = raw.slice(digitsStart, close);
  return close === -1 || !hexDigits.test(digits)
    ? undefined
    : { text: String.fromCodePoint(Number.parseInt(digits, hexRadix)), length: close - offset + 1 };
}

const quotedEscapes: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

const templateEscapes: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '`': '\\`',
  '\r': '\\r',
  '${': '\\${',
};

const quotedSpecials = /[\\\n\r\u2028\u2029'"]/gu;
const templateSpecials = /\\|`|\r|\$\{/gu;

/**
 * How a `quote` literal spells `text` between the raw characters `before` and `after`; undefined
 * when no spelling of it there keeps the literal's substitutions as they are.
 */
export function spell(text: string, quote: Quote, before = '', after = ''): string | undefined {
  if (quote !== '`') {
    return text.replaceAll(quotedSpecials, (special) =>
      special === quote ? `\\${quote}` : (quotedEscapes[special] ?? special),
    );
  }
  const spelled = text.replaceAll(
    templateSpecials,
    (special) => templateEscapes[special] ?? special,
  );
  const opensSubstitution =
    (before === '$' && `${spelled}${after}`.startsWith('{')) ||
    (spelled.endsWith('$') && after === '{');
  return opensSubstitution ? undefined : spelled;
}
