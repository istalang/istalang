/**
 * The scanner: source text → tokens, comments and diagnostics (spec §2.1).
 *
 * It is context-free, total and lossless:
 * - Context-free: no token depends on syntactic context. Layout is left to the parser (see
 *   syntax/tokens/index.ts).
 * - Total: it never throws, and every malformed input still yields tokens and diagnostics.
 * - Lossless: tokens, comments and whitespace cover the source exactly, so the formatter and editor
 *   tooling can account for every character.
 *
 * This module owns the main loop: trivia, line starts, identifiers and unknown characters. Each
 * literal family lives in its own module. Characters that start no token are grouped into one
 * `unknown` token per run, so a pasted paragraph of prose costs one diagnostic, not one per letter.
 *
 * A template's values are code, scanned by the same loop up to the `}` that closes each: braces
 * opened inside a value are counted, and anything else that could hold a `}` (strings, templates)
 * is already one token. Their comments join the file's, in source order.
 */

import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { codePointWidth } from '../../foundation/text/code-points.ts';
import { lineBreakLength } from '../../foundation/text/line-map.ts';
import type { SourceText } from '../../foundation/text/source-text.ts';
import { type Comment, isKeyword, type ScanResult, type Token } from '../syntax/tokens/index.ts';
import {
  identifierRunEnd,
  isDecimalDigit,
  isIdentifierStart,
  isInlineWhitespace,
  isQuote,
} from './characters.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import type { ScannedLexeme } from './lexeme.ts';
import { scanNumber } from './numbers.ts';
import { matchPunctuator } from './punctuators.ts';
import { scanString } from './strings.ts';
import { docstringDelimiter, type ScannedValue, scanDocstring, scanTemplate } from './templates.ts';

/**
 * How deeply template values may nest. Each level costs a few host stack frames, so this keeps
 * scanning far from the stack's limit, as the parser's nesting limit does for parsing.
 */
const templateNestingLimit = 100;

/** Splits a source into tokens, comments and diagnostics; never throws. */
export function scan(source: SourceText): ScanResult {
  return new Scanner(source.text).run();
}

class Scanner {
  readonly #text: string;
  readonly #comments: Comment[] = [];
  readonly #diagnostics: Diagnostic[] = [];
  #offset = 0;
  /** Current line's state: whether it has a token yet, and its first leading tab (§2.1). */
  #line: { hasToken: boolean; indentationTab?: number } = { hasToken: false };
  /** How many template values enclose the token being scanned. */
  #valueDepth = 0;

  constructor(text: string) {
    this.#text = text;
  }

  run(): ScanResult {
    const { tokens } = this.#scanTokens(false);
    return { tokens, comments: this.#comments, diagnostics: this.#diagnostics };
  }

  /**
   * Scans tokens to the end of the text or, for a template's value, to the `}` closing it, and
   * adds the `end` token there.
   */
  #scanTokens(isValue: boolean): ScannedValue {
    const tokens: Token[] = [];
    let depth = 0;
    this.#skipTrivia();
    while (this.#offset < this.#text.length) {
      if (isValue && depth === 0 && this.#text[this.#offset] === '}') {
        return { tokens: [...tokens, this.#endToken()], end: this.#offset, closed: true };
      }
      const token = this.#scanToken();
      depth += braceChange[token.kind] ?? 0;
      tokens.push(token);
      this.#skipTrivia();
    }
    return { tokens: [...tokens, this.#endToken()], end: this.#offset, closed: false };
  }

  #endToken(): Token {
    const end = this.#offset;
    return { kind: 'end', span: { start: end, end }, firstOnLine: true };
  }

  /**
   * Scans the value of a template from `from`; the main loop goes on where the template ends.
   * Past the nesting limit, the value is refused and its `${` stays text.
   */
  #scanValue(from: number): ScannedValue | undefined {
    if (this.#valueDepth >= templateNestingLimit) {
      const span = { start: from - 2, end: from };
      this.#diagnostics.push(scannerDiagnostics.templateNestingTooDeep(span, templateNestingLimit));
      return undefined;
    }
    const outerLine = { ...this.#line };
    this.#offset = from;
    this.#valueDepth += 1;
    const value = this.#scanTokens(true);
    this.#valueDepth -= 1;
    this.#line = outerLine;
    return value;
  }

  /** Skips whitespace, line breaks and comments, tracking where lines start. */
  #skipTrivia(): void {
    while (this.#offset < this.#text.length && this.#startsTrivia(this.#offset)) {
      const breakLength = lineBreakLength(this.#text, this.#offset);
      if (breakLength > 0) {
        this.#offset += breakLength;
        this.#line = { hasToken: false };
      } else if (this.#text[this.#offset] === '#') {
        this.#skipComment();
      } else {
        if (this.#text[this.#offset] === '\t' && !this.#line.hasToken) {
          this.#line.indentationTab ??= this.#offset;
        }
        this.#offset += 1;
      }
    }
  }

  #startsTrivia(offset: number): boolean {
    const char = this.#text[offset];
    return isInlineWhitespace(char) || char === '#' || lineBreakLength(this.#text, offset) > 0;
  }

  #skipComment(): void {
    const start = this.#offset;
    while (this.#offset < this.#text.length && lineBreakLength(this.#text, this.#offset) === 0) {
      this.#offset += 1;
    }
    this.#comments.push({ span: { start, end: this.#offset } });
  }

  #scanToken(): Token {
    const start = this.#offset;
    const firstOnLine = !this.#line.hasToken;
    if (firstOnLine && this.#line.indentationTab !== undefined) {
      const tab = this.#line.indentationTab;
      this.#diagnostics.push(scannerDiagnostics.tabIndentation({ start: tab, end: tab + 1 }));
    }
    this.#line.hasToken = true;
    const scanLexeme = this.#lexemeScannerAt(start);
    const lexeme = scanLexeme === undefined ? this.#scanUnknownRun(start) : scanLexeme();
    this.#offset = lexeme.end;
    return { ...lexeme.token, span: { start, end: lexeme.end }, firstOnLine };
  }

  /**
   * The scanner for the lexeme starting at `start`, or undefined if none starts there. Choosing a
   * scanner has no side effects, so the unknown-run loop can use it as a test.
   */
  #lexemeScannerAt(start: number): (() => ScannedLexeme) | undefined {
    const text = this.#text;
    const char = text[start];
    if (isIdentifierStart(char)) {
      return () => scanWord(text, start);
    }
    if (isDecimalDigit(char)) {
      return () => scanNumber(text, start, this.#diagnostics);
    }
    if (text.startsWith(docstringDelimiter, start)) {
      return () => scanDocstring(text, start, this.#diagnostics);
    }
    if (isQuote(char)) {
      return () => scanString(text, start, this.#diagnostics);
    }
    if (char === '`') {
      return () => scanTemplate(text, start, this.#diagnostics, (from) => this.#scanValue(from));
    }
    const punctuator = matchPunctuator(text, start);
    return punctuator === undefined
      ? undefined
      : () => ({ end: start + punctuator.length, token: { kind: punctuator } });
  }

  #scanUnknownRun(start: number): ScannedLexeme {
    let end = start;
    do {
      end += codePointWidth(this.#text, end);
    } while (
      end < this.#text.length &&
      !this.#startsTrivia(end) &&
      this.#lexemeScannerAt(end) === undefined
    );
    const span = { start, end };
    this.#diagnostics.push(
      scannerDiagnostics.unexpectedCharacter(span, this.#text.slice(start, end)),
    );
    return { end, token: { kind: 'unknown' } };
  }
}

/** How a token changes the depth of braces a template's value has opened. */
const braceChange: Partial<Record<Token['kind'], number>> = { '{': 1, '}': -1 };

/** A keyword or an identifier. */
function scanWord(text: string, start: number): ScannedLexeme {
  const end = identifierRunEnd(text, start);
  const word = text.slice(start, end);
  return { end, token: { kind: isKeyword(word) ? word : 'identifier' } };
}
