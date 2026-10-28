/**
 * Templates and docstrings (spec §2): the literals that span lines.
 *
 * - A template, `` `…${value}…` ``, takes a string's escapes and holds values. Where a value's `}`
 *   stands is known only by scanning the code inside it, which may hold braces, strings and other
 *   templates, so the main loop scans the value (`ValueScanner`) and the template keeps its tokens.
 * - A docstring, `"""…"""`, is raw: no escapes and no values, ending at the first `"""`.
 * - Both lay out their lines by one rule (multi-line.ts).
 *
 * Neither ends at a line break, so a missing closing delimiter runs to the end of the text; the
 * diagnostic points at the opening one.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { lineBreakLength } from '../../text/line-map.ts';
import type { Span } from '../../text/span.ts';
import type { TemplateValue, Token } from '../syntax/tokens.ts';
import { scannerDiagnostics } from './diagnostics.ts';
import type { ScannedLexeme } from './lexeme.ts';
import { type LinePiece, layOutLines, PieceReader } from './multi-line.ts';
import { scanEscape, validEscapes } from './strings.ts';

/**
 * A value's tokens, ending with an `end` token at its `}`, where scanning it stopped, and whether
 * that `}` was found.
 */
export interface ScannedValue {
  readonly tokens: readonly Token[];
  readonly end: number;
  readonly closed: boolean;
}

/**
 * Scans the code of a template's value from `from`, up to the `}` closing it; undefined where
 * templates nest too deeply to hold another value, which leaves `${` as text.
 */
export type ValueScanner = (from: number) => ScannedValue | undefined;

export const docstringDelimiter = '"""';

/** Scans the template whose backtick is at `start`. */
export function scanTemplate(
  text: string,
  start: number,
  diagnostics: Diagnostic[],
  scanValue: ValueScanner,
): ScannedLexeme {
  return new TemplateScanner(text, start, diagnostics, scanValue).scan();
}

/** One template's texts and values, scanned from its backtick on. */
class TemplateScanner {
  readonly #text: string;
  readonly #start: number;
  readonly #diagnostics: Diagnostic[];
  readonly #scanValue: ValueScanner;
  readonly #texts: { readonly span: Span; readonly pieces: readonly LinePiece[] }[] = [];
  readonly #values: TemplateValue[] = [];
  #offset: number;
  #textStart: number;
  #reader: PieceReader;

  constructor(text: string, start: number, diagnostics: Diagnostic[], scanValue: ValueScanner) {
    this.#text = text;
    this.#start = start;
    this.#diagnostics = diagnostics;
    this.#scanValue = scanValue;
    this.#offset = start + 1;
    this.#textStart = this.#offset;
    this.#reader = new PieceReader(text, this.#offset);
  }

  scan(): ScannedLexeme {
    const text = this.#text;
    while (this.#offset < text.length && text[this.#offset] !== '`') {
      if (!this.#step()) {
        return this.#lexeme(this.#offset);
      }
    }
    this.#endText(this.#offset);
    if (this.#offset < text.length) {
      return this.#lexeme(this.#offset + 1);
    }
    const backtick = { start: this.#start, end: this.#start + 1 };
    this.#diagnostics.push(scannerDiagnostics.unterminatedTemplate(backtick));
    return this.#lexeme(this.#offset);
  }

  /** Scans what stands at the offset; false once a value without its `}` has ended the template. */
  #step(): boolean {
    const text = this.#text;
    const offset = this.#offset;
    const breakLength = lineBreakLength(text, offset);
    if (breakLength > 0) {
      this.#reader.add({ kind: 'break' }, offset, offset + breakLength);
      this.#offset += breakLength;
      return true;
    }
    if (text[offset] === '\\') {
      this.#offset = this.#scanEscape(offset);
      return true;
    }
    const value = text.startsWith('${', offset) ? this.#scanValue(offset + 2) : undefined;
    if (value === undefined) {
      this.#offset += 1;
      return true;
    }
    return this.#addValue(value);
  }

  /**
   * Adds the escape whose backslash is at `backslash`; where it ends. A backslash ending a line
   * escapes nothing: it is reported and dropped, and the line break stays.
   */
  #scanEscape(backslash: number): number {
    const decoded = scanEscape(this.#text, backslash, this.#diagnostics);
    if (decoded === undefined) {
      const span = { start: backslash, end: backslash + 1 };
      this.#diagnostics.push(scannerDiagnostics.invalidEscape(span, '\\', validEscapes));
      this.#reader.add({ kind: 'escape', text: '' }, backslash, backslash + 1);
      return backslash + 1;
    }
    this.#reader.add({ kind: 'escape', text: decoded.value }, backslash, decoded.end);
    return decoded.end;
  }

  /** Adds the value whose `${` stands at the offset; false if no `}` closes it. */
  #addValue(value: ScannedValue): boolean {
    const opening = this.#offset;
    this.#endText(opening);
    const next = value.closed ? value.end + 1 : value.end;
    this.#values.push({ span: { start: opening, end: next }, tokens: value.tokens });
    this.#offset = next;
    this.#textStart = next;
    this.#reader = new PieceReader(this.#text, next);
    if (!value.closed) {
      const span = { start: opening, end: opening + 2 };
      this.#diagnostics.push(scannerDiagnostics.unterminatedTemplateValue(span));
      this.#endText(next);
    }
    return value.closed;
  }

  #endText(end: number): void {
    this.#texts.push({
      span: { start: this.#textStart, end },
      pieces: this.#reader.piecesUpTo(end),
    });
  }

  #lexeme(end: number): ScannedLexeme {
    const laidOut = layOutLines(this.#texts.map((each) => each.pieces));
    const texts = this.#texts.map((each, index) => ({
      span: each.span,
      value: laidOut[index] ?? '',
    }));
    return { end, token: { kind: 'template', texts, values: this.#values } };
  }
}

/** Scans the docstring whose opening `"""` is at `start`. */
export function scanDocstring(
  text: string,
  start: number,
  diagnostics: Diagnostic[],
): ScannedLexeme {
  const bodyStart = start + docstringDelimiter.length;
  const reader = new PieceReader(text, bodyStart);
  let offset = bodyStart;
  while (offset < text.length && !text.startsWith(docstringDelimiter, offset)) {
    const breakLength = lineBreakLength(text, offset);
    if (breakLength > 0) {
      reader.add({ kind: 'break' }, offset, offset + breakLength);
    }
    offset += Math.max(breakLength, 1);
  }
  const [value = ''] = layOutLines([reader.piecesUpTo(offset)]);
  const token = { kind: 'docstring', value } as const;
  if (offset < text.length) {
    return { end: offset + docstringDelimiter.length, token };
  }
  diagnostics.push(scannerDiagnostics.unterminatedDocstring({ start, end: bodyStart }));
  return { end: offset, token };
}
