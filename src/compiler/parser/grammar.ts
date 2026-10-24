/**
 * Wires the grammar categories into the parsing context (parser.ts). This is the one module that
 * knows every category, so the categories themselves never import one another.
 */

import type { SourceText } from '../../text/source-text.ts';
import type { ScanResult } from '../syntax/tokens.ts';
import { parseTopLevelDeclaration } from './declarations/declaration.ts';
import { parseDefinedFunction } from './declarations/functions.ts';
import { continueExpression, parseExpression, startsExpression } from './expressions/expression.ts';
import { nested } from './nesting.ts';
import { type Grammar, Parser } from './parser.ts';
import { parsePattern } from './patterns.ts';
import { parseStatement } from './statements/statement.ts';
import { parseParameterType, parseType, parseTypeArguments } from './types.ts';

/** Every entry that can recurse descends one level of nesting first (nesting.ts). */
const grammar: Grammar = {
  expression: (parser, minLevel) => nested(parser, () => parseExpression(parser, minLevel)),
  continueExpression,
  startsExpression,
  type: (parser) => nested(parser, () => parseType(parser)),
  parameterType: (parser) => nested(parser, () => parseParameterType(parser)),
  typeArguments: parseTypeArguments,
  pattern: (parser) => nested(parser, () => parsePattern(parser)),
  statement: (parser) => nested(parser, () => parseStatement(parser)),
  topLevelDeclaration: parseTopLevelDeclaration,
  functionDeclaration: parseDefinedFunction,
};

/** A parser positioned at the first token of a scanned source. */
export function createParser(source: SourceText, scanned: ScanResult): Parser {
  return new Parser(source, scanned.tokens, grammar);
}
