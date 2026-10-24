/**
 * Postfix parselets (§3.9, tightest level): calls, indexing, member access, `?`, `$`, struct
 * literals after a name, and type arguments.
 *
 * `name<…>` is ambiguous with a comparison. Following C#, it is read as type arguments only when
 * the bracket contents parse as types and a `(` or `{` follows (gap G9). Otherwise it is a
 * comparison, and `(a < b) > c` needs its parentheses. Only the type arguments are parsed
 * speculatively. The call or literal after them is parsed for real, so errors inside the
 * arguments are reported rather than turning the whole thing back into a comparison.
 *
 * A struct literal's `{` and type arguments both attach only to a name or a qualified name (gap
 * G10). Nothing else can stand before them, so the parser never needs to know what a name means.
 */

import type { Call, Expression, Spread } from '../../syntax/expressions.ts';
import type { QualifiedName } from '../../syntax/node.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { namedTypeFrom } from '../parts/names.ts';
import { parseDelimited, parseEnclosed } from '../recovery.ts';
import { parseReference } from './operators.ts';
import type { InfixParselet } from './parselet.ts';
import { parseSpread } from './spread.ts';
import { parseStructLiteralBody } from './struct-literals.ts';

/**
 * The names of a qualified name such as `m.Pair`, or undefined for any other expression. Until a
 * `{` or `<…>` follows, a qualified name parses as member accesses; this reads it back as the
 * names alone, whose spans the type keeps.
 */
export function qualifiedPath(expression: Expression): QualifiedName | undefined {
  if (expression.kind === 'Identifier') {
    return [expression];
  }
  if (expression.kind !== 'MemberAccess' || expression.isOptional) {
    return undefined;
  }
  const target = qualifiedPath(expression.target);
  return target === undefined ? undefined : [...target, expression.member];
}

/** `name<…>(…)` or `name<…>{…}`, or undefined when the `<` is a comparison. */
export function parseTypeApplication(parser: Parser, left: Expression): Expression | undefined {
  const path = qualifiedPath(left);
  if (path === undefined) {
    return undefined;
  }
  const typeArguments = parser.speculate(() => {
    const parsed = parser.typeArguments();
    return parser.cursor.at('(') || parser.cursor.at('{') ? parsed : undefined;
  });
  if (typeArguments === undefined) {
    return undefined;
  }
  if (parser.cursor.at('(')) {
    return parseCall(parser, left, typeArguments);
  }
  return parseStructLiteralBody(
    parser,
    namedTypeFrom(parser, path, typeArguments),
    left.span.start,
  );
}

function parseCall(parser: Parser, callee: Expression, typeArguments: readonly TypeNode[]): Call {
  const { items } = parseDelimited(parser, '(', () => parseArgument(parser));
  const span = parser.spanFrom(callee.span.start);
  return { kind: 'Call', span, callee, typeArguments, arguments: items };
}

/** An argument; `&` is allowed only on a whole argument (gap G11). */
function parseArgument(parser: Parser): Expression | Spread {
  const { cursor } = parser;
  if (cursor.at('...')) {
    return parseSpread(parser);
  }
  if (!cursor.at('&')) {
    return parser.expression();
  }
  const reference = parseReference(parser);
  const argument = parser.continueExpression(reference);
  if (argument !== reference) {
    parser.report(parserDiagnostics.misplacedReference(reference.span));
  }
  return argument;
}

export const callParselet: InfixParselet = {
  level: 'postfix',
  parse: (parser, left) => parseCall(parser, left, []),
};

export const indexParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    const index = parseEnclosed(parser, '[', () => parser.expression()).value;
    return { kind: 'Index', span: parser.spanFrom(left.span.start), target: left, index };
  },
};

export function memberParselet(isOptional: boolean): InfixParselet {
  return {
    level: 'postfix',
    parse(parser, left) {
      parser.cursor.advance();
      const member = parser.identifier('a member name');
      const span = parser.spanFrom(left.span.start);
      return { kind: 'MemberAccess', span, target: left, isOptional, member };
    },
  };
}

export const propagateParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    parser.cursor.advance();
    return { kind: 'Propagate', span: parser.spanFrom(left.span.start), operand: left };
  },
};

export const unwrapParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    parser.cursor.advance();
    return { kind: 'Unwrap', span: parser.spanFrom(left.span.start), operand: left };
  },
};

export const structLiteralParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    const path = qualifiedPath(left);
    return path === undefined
      ? undefined
      : parseStructLiteralBody(parser, namedTypeFrom(parser, path, []), left.span.start);
  },
};
