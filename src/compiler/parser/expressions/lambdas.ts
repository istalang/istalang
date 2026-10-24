/**
 * Lambdas (§3.14).
 *
 * After `fn`, the next two tokens decide the form:
 * - `(` starts the parameter list
 * - a name and `(` is a named lambda, whose name is visible only in its own body
 * - a name alone is the single untyped parameter of `fn x: x > 0`
 * The body is one expression, so inside a call it ends at the next `,` or `)` without any special
 * rule. Several statements need a block expression.
 */

import type { Expression, Parameter } from '../../syntax/expressions.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { Parser } from '../parser.ts';
import { parseFunctionKeyword } from '../parts/functions.ts';
import { parseParameters } from '../parts/parameters.ts';

/** A lambda, starting at `fn` or `async`. */
export function parseLambda(parser: Parser): Expression {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const isAsync = parseFunctionKeyword(parser);
  const named = cursor.at('identifier') && cursor.kindAt(1) === '(';
  const name = named ? parser.identifier() : undefined;
  const parameters = parseLambdaParameters(parser);
  const returnType = cursor.eat('->') === undefined ? undefined : parser.type();
  parser.expect(':');
  const body = parser.expression();
  const span = parser.spanFrom(start);
  return { kind: 'Lambda', span, isAsync, name, parameters, returnType, body };
}

function parseLambdaParameters(parser: Parser): readonly (Parameter | Invalid)[] {
  const { cursor } = parser;
  if (cursor.at('(')) {
    return parseParameters(parser);
  }
  if (!cursor.at('identifier')) {
    parser.reportExpected("'(' or a parameter name");
    return [];
  }
  const name = parser.identifier();
  return [
    {
      kind: 'Parameter',
      span: name.span,
      isRest: false,
      name,
      type: undefined,
      defaultValue: undefined,
    },
  ];
}
