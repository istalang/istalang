/**
 * Shared helpers for the parser's tests.
 *
 * Until the module entry exists, tests drive one grammar category at a time through the parsing
 * context, exactly as the grammar itself does. Helpers return observations; assertions stay in the
 * tests. `rest` counts tokens the category left unparsed, so a test can tell "parsed all of it"
 * from "stopped early".
 */

import fc from 'fast-check';
import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { SourceText } from '../../text/source-text.ts';
import { textOf } from '../../text/span.ts';
import { scan } from '../scanner/scan.ts';
import { dump } from '../syntax/tree.test-kit.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import { createParser } from './grammar.ts';
import type { Parser } from './parser.ts';

export type Category = 'expression' | 'type' | 'pattern' | 'parameterType';

export interface Parsed {
  readonly source: SourceText;
  readonly node: SyntaxNode;
  /** The parser's diagnostics; scanner diagnostics are left out. */
  readonly diagnostics: readonly Diagnostic[];
  readonly scanDiagnostics: readonly Diagnostic[];
  readonly rest: number;
}

const categories: Record<Category, (parser: Parser) => SyntaxNode> = {
  expression: (parser) => parser.expression(),
  type: (parser) => parser.type(),
  parameterType: (parser) => parser.parameterType(),
  pattern: (parser) => parser.pattern(),
};

export function parseAs(category: Category, text: string): Parsed {
  const source = { path: 'test.ista', text };
  const scanned = scan(source);
  const parser = createParser(source, scanned);
  const node = categories[category](parser);
  const rest = scanned.tokens.length - 1 - parser.cursor.index;
  return {
    source,
    node,
    diagnostics: parser.diagnostics,
    scanDiagnostics: scanned.diagnostics,
    rest,
  };
}

/** The dump of a category parse that must succeed: consumed everything, reported nothing. */
export function dumpClean(category: Category, text: string): string {
  const parsed = parseAs(category, text);
  const problems = [
    ...parsed.scanDiagnostics.map((diagnostic) => diagnostic.message),
    ...parsed.diagnostics.map((diagnostic) => diagnostic.message),
    ...(parsed.rest > 0 ? [`${parsed.rest} tokens left unparsed`] : []),
  ];
  return problems.length === 0 ? dump(parsed.node) : `NOT CLEAN: ${problems.join(' | ')}`;
}

export interface Reported {
  readonly codes: readonly number[];
  readonly spanTexts: readonly string[];
}

/** The Reported of a parse that reported `code` once, over `spanText`. */
export function reportedOnce(code: number, spanText: string): Reported {
  return { codes: [code], spanTexts: [spanText] };
}

/** The dump of a named type without type arguments. */
export function named(name: string): string {
  return `(NamedType [${name}] [])`;
}

export const int = named('int');

/** What a parse reported: each diagnostic's code and the text its span covers. */
export function reported(category: Category, text: string): Reported {
  const parsed = parseAs(category, text);
  return {
    codes: parsed.diagnostics.map((diagnostic) => diagnostic.code),
    spanTexts: parsed.diagnostics.map((diagnostic) => textOf(parsed.source, diagnostic.span)),
  };
}

const tokenFragments = [
  'a',
  'Pair',
  '_',
  'type',
  '42',
  '3.14',
  '5d',
  '"s"',
  'true',
  'none',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  ';',
  '.',
  '..',
  '..=',
  '...',
  '?',
  '?.',
  '??',
  '+',
  '-',
  '*',
  '//',
  '<',
  '>',
  '==',
  '>=',
  '=',
  '->',
  '&',
  '$',
  '@',
  'fn',
  'async',
  'await',
  'not',
  'and',
  'or',
  'is',
  'as',
  'for',
  'in',
  'if',
  'struct',
  'match',
  '!',
];

const separators = [' ', '', '\n', '\n    '];

/** Random token sequences, valid and broken, with line breaks between some of them. */
export const tokenSoup = fc
  .array(fc.tuple(fc.constantFrom(...tokenFragments), fc.constantFrom(...separators)), {
    maxLength: 30,
  })
  .map((pairs) => pairs.map(([fragment, separator]) => fragment + separator).join(''));

/** A token soup with no `(` or `)`, so a surrounding call's parentheses are the only ones. */
export const parenFreeSoup = tokenSoup.map((text) => text.replaceAll(/[()]/gu, ' '));
