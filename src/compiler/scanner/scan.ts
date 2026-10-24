/**
 * The scanner: source text → tokens, comments and diagnostics (spec §2).
 *
 * It is context-free, total and lossless:
 * - Context-free: no token depends on syntactic context. Layout is left to the parser (see
 *   syntax/tokens.ts).
 * - Total: it never throws, and every malformed input still yields tokens and diagnostics.
 * - Lossless: tokens, comments and whitespace cover the source exactly, so the formatter and editor
 *   tooling can account for every character.
 *
 * This module owns the main loop: trivia, line starts, identifiers and unknown characters. Each
 * literal family lives in its own module. Characters that start no token are grouped into one
 * `unknown` token per run, so a pasted paragraph of prose costs one diagnostic, not one per letter.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { lineBreakLength } from '../../text/line-map.ts';
import { byteOrderMark, type SourceText } from '../../text/source-text.ts';
import { type Comment, isKeyword, type ScanResult, type Token } from '../syntax/tokens.ts';
import {
  codePointWidth,
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

/** Splits a source into tokens, comments and diagnostics; never throws. */
export function scan(source: SourceText): ScanResult {
  return new Scanner(source.text).run();
}

class Scanner {
  readonly #text: string;
  readonly #tokens: Token[] = [];
  readonly #comments: Comment[] = [];
  readonly #diagnostics: Diagnostic[] = [];
  #offset = 0;
  #lineHasToken = false;
  /** Offset of the first tab in the current line's leading whitespace (gap G1). */
  #indentationTab: number | undefined;

  constructor(text: string) {
    this.#text = text;
  }

  run(): ScanResult {
    if (this.#text.startsWith(byteOrderMark)) {
      this.#offset = byteOrderMark.length;
    }
    this.#skipTrivia();
    while (this.#offset < this.#text.length) {
      this.#scanToken();
      this.#skipTrivia();
    }
    const end = this.#text.length;
    this.#tokens.push({ kind: 'end', span: { start: end, end }, firstOnLine: true });
    return { tokens: this.#tokens, comments: this.#comments, diagnostics: this.#diagnostics };
  }

  /** Skips whitespace, line breaks and comments, tracking where lines start. */
  #skipTrivia(): void {
    while (this.#offset < this.#text.length && this.#startsTrivia(this.#offset)) {
      const breakLength = lineBreakLength(this.#text, this.#offset);
      if (breakLength > 0) {
        this.#offset += breakLength;
        this.#lineHasToken = false;
        this.#indentationTab = undefined;
      } else if (this.#text[this.#offset] === '#') {
        this.#skipComment();
      } else {
        if (this.#text[this.#offset] === '\t' && !this.#lineHasToken) {
          this.#indentationTab ??= this.#offset;
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

  #scanToken(): void {
    const start = this.#offset;
    const firstOnLine = !this.#lineHasToken;
    if (firstOnLine && this.#indentationTab !== undefined) {
      const tab = this.#indentationTab;
      this.#diagnostics.push(scannerDiagnostics.tabIndentation({ start: tab, end: tab + 1 }));
    }
    this.#lineHasToken = true;
    const scanLexeme = this.#lexemeScannerAt(start);
    const lexeme = scanLexeme === undefined ? this.#scanUnknownRun(start) : scanLexeme();
    this.#tokens.push({ ...lexeme.token, span: { start, end: lexeme.end }, firstOnLine });
    this.#offset = lexeme.end;
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
    if (isQuote(char)) {
      return () => scanString(text, start, this.#diagnostics);
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

/** A keyword or an identifier. */
function scanWord(text: string, start: number): ScannedLexeme {
  const end = identifierRunEnd(text, start);
  const word = text.slice(start, end);
  return { end, token: { kind: isKeyword(word) ? word : 'identifier' } };
}
