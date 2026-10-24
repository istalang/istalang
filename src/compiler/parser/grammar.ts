/**
 * Wires the grammar categories into the parsing context (parser.ts). This is the one module that
 * knows every category, so the categories themselves never import one another.
 */

import type { SourceText } from '../../text/source-text.ts';
import type { ScanResult } from '../syntax/tokens.ts';
import { continueExpression, parseExpression, startsExpression } from './expressions/expression.ts';
import { type Grammar, Parser } from './parser.ts';
import { parsePattern } from './patterns.ts';
import { parseParameterType, parseType, parseTypeArguments } from './types.ts';

const grammar: Grammar = {
  expression: parseExpression,
  continueExpression,
  startsExpression,
  type: parseType,
  parameterType: parseParameterType,
  typeArguments: parseTypeArguments,
  pattern: parsePattern,
};

/** A parser positioned at the first token of a scanned source. */
export function createParser(source: SourceText, scanned: ScanResult): Parser {
  return new Parser(source, scanned.tokens, grammar);
}
