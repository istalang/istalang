/**
 * Character classes of the lexical grammar (spec §2).
 *
 * Identifiers are ASCII-only in v0.1 (§2), so every class is a comparison on one UTF-16 unit.
 * Unicode appears only inside strings and comments, which the scanner copies without classifying.
 * The functions take `string | undefined` so that callers can pass `text[i]` past the end of input
 * and get `false` instead of a special case.
 */

/** Whitespace between tokens. Line breaks are handled separately (see lineBreakLength). */
export function isInlineWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

export function isDecimalDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

export function isHexDigit(char: string | undefined): boolean {
  return (
    isDecimalDigit(char) ||
    (char !== undefined && ((char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')))
  );
}

export function isIdentifierStart(char: string | undefined): boolean {
  return (
    char !== undefined &&
    ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_')
  );
}

function isIdentifierPart(char: string | undefined): boolean {
  return isIdentifierStart(char) || isDecimalDigit(char);
}

export function isQuote(char: string | undefined): boolean {
  return char === '"' || char === "'";
}

const lastBasicPlaneCodePoint = 0xff_ff;

/** UTF-16 length of the code point at `offset`: 2 for a surrogate pair, else 1. */
export function codePointWidth(text: string, offset: number): number {
  return (text.codePointAt(offset) ?? 0) > lastBasicPlaneCodePoint ? 2 : 1;
}

/** Index just past the run of identifier characters starting at `offset`. */
export function identifierRunEnd(text: string, offset: number): number {
  let end = offset;
  while (isIdentifierPart(text[end])) {
    end += 1;
  }
  return end;
}
