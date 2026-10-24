/**
 * Shared helpers for the parser's tests.
 *
 * Tests drive one grammar category at a time through the parsing context, exactly as the grammar
 * itself does, or a whole module through the parser's entry. Helpers return observations; assertions stay in the
 * tests. `rest` counts tokens the category left unparsed, so a test can tell "parsed all of it"
 * from "stopped early".
 */

import { soupOf } from '../../../test/soup.ts';
import { type Reported, reportedIn } from '../../diagnostics/diagnostic.test-kit.ts';
import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { createSourceText, type SourceText } from '../../text/source-text.ts';
import { scan } from '../scanner/scan.ts';
import { dump } from '../syntax/tree.test-kit.ts';
import type { SyntaxNode } from '../syntax/tree.ts';
import { parseModule } from './declarations/declaration.ts';
import { createParser } from './grammar.ts';
import type { Parser } from './parser.ts';

export type Category = 'expression' | 'type' | 'pattern' | 'parameterType' | 'statement' | 'module';

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
  statement: (parser) => parser.statement(),
  module: parseModule,
};

export function parseAs(category: Category, text: string): Parsed {
  const source = createSourceText('test.ista', text);
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

/** Lines joined into one source text, so a test can show its layout line by line. */
export function lines(...source: readonly string[]): string {
  return source.join('\n');
}

/** The dump of an expression statement. */
export function expressionStatement(expression: string): string {
  return `(ExpressionStatement ${expression})`;
}

/** The dump of a block of statements. */
export function block(...statements: readonly string[]): string {
  return `(Block [${statements.join(' ')}])`;
}

/** The dump of a body holding one expression, as `if a: x` holds `x`. */
export function bodyOf(expression: string): string {
  return block(expressionStatement(expression));
}

/** The dump of an `if` with one branch, and an `else` if `elseBody` is given. */
export function ifThen(condition: string, body: string, elseBody?: string): string {
  const elseClause = elseBody === undefined ? '_' : `(ElseClause ${elseBody})`;
  return `(If [(ConditionalBranch ${condition} ${body})] ${elseClause})`;
}

/** The dump of a function with no type parameters, parameters or return type. */
export function functionOf(name: string, body: string): string {
  return `(FunctionDeclaration _ ${name} [] [] _ ${body})`;
}

/** The dump of a module of `items`. */
export function moduleOf(...items: readonly string[]): string {
  return `(Module [${items.join(' ')}])`;
}

/** The dump of a field declaration. */
export function field(name: string, type: string): string {
  return `(FieldDeclaration ${name} ${type})`;
}

/** The dump of a named type without type arguments. */
export function named(name: string): string {
  return `(NamedType [${name}] [])`;
}

export const int = named('int');

/** What a parse reported: each diagnostic's code and the text its span covers. */
export function reported(category: Category, text: string): Reported {
  const parsed = parseAs(category, text);
  return reportedIn(parsed.source, parsed.diagnostics);
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
export const tokenSoup = soupOf(tokenFragments, separators, 30);

/** A token soup with no `(` or `)`, so a surrounding call's parentheses are the only ones. */
export const parenFreeSoup = tokenSoup.map((text) => text.replaceAll(/[()]/gu, ' '));
