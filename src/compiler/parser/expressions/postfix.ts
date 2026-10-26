/**
 * Postfix parselets (§3.9, tightest level): calls, indexing, member access, `?`, `$`, struct
 * literals after a name, and type arguments.
 *
 * `name<…>` is ambiguous with a comparison. Following C#, it is read as type arguments only when
 * the bracket contents parse as types and a `(` or `{` follows (§3.5). Otherwise it is a
 * comparison, and `(a < b) > c` needs its parentheses. Only the type arguments are parsed
 * speculatively. The call or literal after them is parsed for real, so errors inside the
 * arguments are reported rather than turning the whole thing back into a comparison.
 *
 * A struct literal's `{` and type arguments both attach only to a name or a qualified name
 * (§2). Nothing else can stand before them, so the parser never needs to know what a name means.
 *
 * After `.`, a number names a tuple element (§3.15). The scanner reads the `0.1` of `t.0.1` as
 * one float, so that token is split back into its two elements here.
 */

import { type Call, type Expression, isPlace, type Spread } from '../../syntax/expressions.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { namedTypeFrom, qualifiedPath } from '../parts/names.ts';
import { parseDelimited, parseEnclosed } from '../recovery.ts';
import { parseReference } from './operators.ts';
import type { InfixParselet } from './parselet.ts';
import { parseSpread } from './spread.ts';
import { parseStructLiteralBody } from './struct-literals.ts';

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

/** An argument; `&` is allowed only on a whole argument (§3.7), and passes a place. */
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
  } else if (!isPlace(reference.expression)) {
    parser.report(parserDiagnostics.referenceNotPlace(reference.expression.span));
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
      const { kind } = parser.cursor;
      if (!isOptional && (kind === 'integer' || kind === 'float')) {
        return parseTupleElements(parser, left);
      }
      const member = parser.identifier('a member name');
      const span = parser.spanFrom(left.span.start);
      return { kind: 'MemberAccess', span, target: left, isOptional, member };
    },
  };
}

/** Decimal positions only: `t.0`, `t.12`, and `t.0.1` read as one token. */
const tupleElementText = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/u;

/** The tuple element (or two, from a float token) after a `.`, at the number. */
function parseTupleElements(parser: Parser, left: Expression): Expression {
  const token = parser.cursor.advance();
  const text = parser.textOf(token);
  if (!tupleElementText.test(text)) {
    parser.report(parserDiagnostics.invalidTupleElement(token.span, text));
    return { kind: 'Invalid', span: parser.spanFrom(left.span.start) };
  }
  const [first, second] = text.split('.');
  const firstEnd = token.span.start + (first?.length ?? 0);
  const outer: Expression = {
    kind: 'TupleElement',
    span: { start: left.span.start, end: firstEnd },
    target: left,
    element: Number(first),
  };
  if (second === undefined) {
    return outer;
  }
  const span = parser.spanFrom(left.span.start);
  return { kind: 'TupleElement', span, target: outer, element: Number(second) };
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
