/**
 * Parameter lists, shared by lambdas and function declarations (§3.3, §3.14): defaults, rest
 * parameters, and reference types, which only a parameter's type may have (§3.7).
 */

import type { Parameter } from '../../syntax/expressions/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { Parser } from '../parser.ts';
import { parseDelimited } from '../recovery.ts';

/** `(a: int, b = 1, ...rest: Array<T>)`, starting at the `(`. */
export function parseParameters(parser: Parser): readonly (Parameter | Invalid)[] {
  return parseDelimited(parser, '(', () => parseParameter(parser)).items;
}

function parseParameter(parser: Parser): Parameter {
  const { cursor } = parser;
  const rest = cursor.eat('...');
  const name = parser.identifier('a parameter name');
  const type = cursor.eat(':') === undefined ? undefined : parser.parameterType();
  const defaultValue = cursor.eat('=') === undefined ? undefined : parser.expression();
  const span = parser.spanFrom(rest?.span.start ?? parser.startOf(name));
  return { kind: 'Parameter', span, isRest: rest !== undefined, name, type, defaultValue };
}
