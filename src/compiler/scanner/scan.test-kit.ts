/**
 * Shared helpers for the scanner's tests.
 *
 * Tests go through `scan` only, the scanner's public entry, so they check behaviour rather than
 * internal structure. Helpers return observations instead of asserting, so every assertion stays
 * visible in the test that makes it.
 *
 * The fragment generator mixes valid lexemes, malformed ones and hostile characters (stray
 * symbols, emoji, a byte order mark mid-text, a lone backslash). The property tests therefore
 * explore the error paths as well as the happy ones.
 */

import fc from 'fast-check';
import { soupOf } from '../../../test/soup.ts';
import { type Reported, reportedIn } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { createSourceText, type SourceText } from '../../foundation/text/source-text.ts';
import type { Span } from '../../foundation/text/span.ts';
import { textOf } from '../../foundation/text/span.ts';
import type { ScanResult, Token } from '../syntax/tokens/index.ts';
import { scan } from './scan.ts';

interface ScannedText extends ScanResult {
  readonly source: SourceText;
}

export function scanText(text: string): ScannedText {
  const source = createSourceText('test.ista', text);
  return { source, ...scan(source) };
}

/** The tokens of a scan, without the final `end` token. */
export function lexemes(scanned: ScanResult): readonly Token[] {
  return scanned.tokens.slice(0, -1);
}

/** Each token's kind and source text, for compact assertions. */
export function kindsAndTexts(scanned: ScannedText): readonly (readonly [string, string])[] {
  return lexemes(scanned).map((token) => [token.kind, textOf(scanned.source, token.span)]);
}

/** The token a text scans to, if it scans to exactly one token and no diagnostics. */
export function soleToken(text: string): Token | undefined {
  const scanned = scanText(text);
  return scanned.diagnostics.length === 0 && scanned.tokens.length === 2
    ? scanned.tokens[0]
    : undefined;
}

const triviaCharacters = new Set([' ', '\t', '\r', '\n']);

function isTrivia(gap: string): boolean {
  return [...gap].every((char) => triviaCharacters.has(char));
}

/**
 * The spans a token covers itself. A template covers its delimiters and texts; the tokens of its
 * values cover the code inside each `${…}`, as top-level tokens cover the rest.
 */
function coveredSpans(token: Token): readonly Span[] {
  if (token.kind !== 'template') {
    return [token.span];
  }
  const own: Span[] = [];
  let from = token.span.start;
  for (const value of token.values) {
    own.push({ start: from, end: value.span.start + 2 });
    from = value.tokens.at(-1)?.span.start ?? value.span.end;
  }
  own.push({ start: from, end: token.span.end });
  const inner = token.values.flatMap((value) => value.tokens.flatMap(coveredSpans));
  return [...own.filter((span) => span.end > span.start), ...inner];
}

/**
 * How a scan fails to cover its text exactly: overlaps, gaps holding more than whitespace, empty
 * tokens, a missing or misplaced end token. Empty when the scan is lossless.
 */
export function losslessnessViolations(scanned: ScannedText): readonly string[] {
  const { text } = scanned.source;
  const violations: string[] = [];
  const pieces = [
    ...scanned.tokens.flatMap(coveredSpans),
    ...scanned.comments.map((comment) => comment.span),
  ].sort((left, right) => left.start - right.start || left.end - right.end);
  let covered = 0;
  for (const span of pieces) {
    if (span.start < covered) {
      violations.push(`span ${span.start}–${span.end} overlaps the previous one`);
    } else if (!isTrivia(text.slice(covered, span.start))) {
      violations.push(`text ${covered}–${span.start} belongs to no token or comment`);
    }
    covered = Math.max(covered, span.end);
  }
  if (covered !== text.length) {
    violations.push(`coverage ends at ${covered}, not ${text.length}`);
  }
  const end = scanned.tokens.at(-1);
  if (end?.kind !== 'end' || end.span.start !== text.length || end.span.end !== text.length) {
    violations.push('the last token is not an empty end token at the end of the text');
  }
  if (lexemes(scanned).some((token) => token.span.end <= token.span.start)) {
    violations.push('a token is empty');
  }
  return violations;
}

interface MalformedScan extends Reported {
  /** Whether the line after the malformed input still starts with the identifier `next`. */
  readonly resumes: boolean;
}

/** Scans `input` then a line holding `next`: what was reported, and whether scanning went on. */
export function scanMalformed(input: string): MalformedScan {
  const scanned = scanText(`${input}\nnext`);
  const last = scanned.tokens.at(-2);
  return {
    ...reportedIn(scanned.source, scanned.diagnostics),
    resumes:
      last?.kind === 'identifier' &&
      last.firstOnLine &&
      textOf(scanned.source, last.span) === 'next',
  };
}

/** The MalformedScan of input that reported `reported` and was then scanned past. */
export function scannedPast(reported: Reported): MalformedScan {
  return { ...reported, resumes: true };
}

const fragments = [
  'fn',
  'await',
  'type',
  'from',
  'userId',
  'Pair',
  '_',
  '42',
  '1_000',
  '0x1F',
  '0b1010',
  '3.14',
  '1e9',
  '2.5e-3',
  '500ms',
  '5d',
  '"text"',
  "'it\\'s'",
  '"\\u{1F600}"',
  '...',
  '..=',
  '?.',
  '??',
  '//=',
  '->',
  '>',
  '{',
  ')',
  '# comment',
  '1__0',
  '0b102',
  '0x',
  '1.5h',
  '5days',
  '"open',
  "'\\q'",
  '"\\u{110000}"',
  '"\\u{D800}"',
  '!',
  '€',
  '😀',
  '\uFEFF',
  '\\',
  '`',
  '`text ${x} more`',
  '`${`${1}`}`',
  '`a\\`b ${ {} } \\${`',
  '`open ${',
  '${',
  '}',
  '"""doc"""',
  '"""',
];

const separators = [' ', '', '\n', '\r\n', '\r', '\t', '  '];

/** Random sequences of valid and malformed lexemes, joined by random whitespace. */
export const fragmentSoup = soupOf(fragments, separators, 40);

/** Arbitrary UTF-16 text, lone surrogates included. */
export const anyUtf16 = fc.string({
  unit: fc.integer({ min: 0, max: 0xff_ff }).map((code) => String.fromCharCode(code)),
  maxLength: 200,
});
