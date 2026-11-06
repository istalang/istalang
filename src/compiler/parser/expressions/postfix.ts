/**
 * Postfix parselets (§3.9, tightest level): calls, indexing, member access, `->`, `?`, `!`, struct
 * literals after a name, and type arguments.
 *
 * A call's argument is a value, a spread, or `name: value` naming its parameter (§3.3); only a
 * name directly followed by `:` names one, since nothing else in an argument list starts so.
 *
 * `name<…>` is ambiguous with a comparison. Following C#, it is read as type arguments only when
 * the bracket contents parse as types and a `(` or `{` follows (§3.5). Literal types and unions
 * are types, so `a < 1 > (b)` and `a < b | c > (d)` are calls. Otherwise it is a comparison, and
 * `(a < b) > c` needs its parentheses. Only the type arguments are parsed
 * speculatively. The call or literal after them is parsed for real, so errors inside the
 * arguments are reported rather than turning the whole thing back into a comparison.
 *
 * A struct literal's `{` and type arguments both attach only to a name or a qualified name
 * (§2). Nothing else can stand before them, so the parser never needs to know what a name means.
 *
 * `x->f` is `(*x).f` (§3.9), so it is read as that: a member access on a `Dereference` of `x`.
 * `x?->f` reads through an optional the same way, as a link of an optional chain (§4).
 *
 * After `.` or `->`, a number names a tuple element (§3.15). The scanner reads the `0.1` of
 * `t.0.1` as one float, so that token is split back into its two elements here.
 */

import { misplacedArgument } from '../../syntax/expressions/arguments.ts';
import type {
  Call,
  CallArgument,
  Dereference,
  Expression,
  Index,
} from '../../syntax/expressions/index.ts';
import { isPlace } from '../../syntax/expressions/places.ts';
import { qualifiedPath } from '../../syntax/expressions/readings.ts';
import type { TypeNode } from '../../syntax/types/index.ts';
import { parseDelimited, parseEnclosed } from '../brackets/recovery.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { atPostfix } from '../layout/item-breaks.ts';
import type { Parser } from '../parser.ts';
import { namedTypeFrom } from '../parts/names.ts';
import { parseSpread, spreadOpener } from '../parts/spreads.ts';
import { parseStructLiteralBody } from './literals/struct-literals.ts';
import { parseReference } from './operators.ts';
import type { InfixParselet } from './parselet.ts';

/** `name<…>(…)` or `name<…>{…}`, or undefined when the `<` is a comparison. */
export function parseTypeApplication(parser: Parser, left: Expression): Expression | undefined {
  const path = qualifiedPath(left);
  if (path === undefined) {
    return undefined;
  }
  const typeArguments = parser.speculate(() => {
    const parsed = parser.typeArguments();
    return atPostfix(parser, '(') || atPostfix(parser, '{') ? parsed : undefined;
  });
  if (typeArguments === undefined) {
    return undefined;
  }
  if (atPostfix(parser, '(')) {
    return parseCall(parser, left, false, typeArguments);
  }
  return parseStructLiteralBody(
    parser,
    namedTypeFrom(parser, path, typeArguments),
    parser.startOf(left),
  );
}

function parseCall(
  parser: Parser,
  callee: Expression,
  isOptional: boolean,
  typeArguments: readonly TypeNode[],
): Call {
  const { items } = parseDelimited(parser, '(', () => parseArgument(parser));
  const span = parser.spanFrom(parser.startOf(callee));
  const misplaced = misplacedArgument(items);
  if (misplaced !== undefined && misplaced.kind !== 'Invalid') {
    parser.report(parserDiagnostics.positionalAfterNamed(parser.textSpanOf(misplaced.span)));
  }
  return { kind: 'Call', span, callee, isOptional, typeArguments, arguments: items };
}

/** An argument: a spread, a value named by its parameter, or a value. */
function parseArgument(parser: Parser): CallArgument {
  const { cursor } = parser;
  if (cursor.at(spreadOpener)) {
    return parseSpread(parser);
  }
  if (cursor.at('identifier') && cursor.kindAt(1) === ':') {
    const name = parser.identifier('a parameter name');
    cursor.advance();
    const value = parseArgumentValue(parser);
    return { kind: 'NamedArgument', span: parser.spanFrom(parser.startOf(name)), name, value };
  }
  return parseArgumentValue(parser);
}

/** An argument's value; `&` is allowed only on a whole value (§3.7), and passes a place. */
function parseArgumentValue(parser: Parser): Expression {
  const { cursor } = parser;
  if (!cursor.at('&')) {
    return parser.expression();
  }
  const reference = parseReference(parser);
  const argument = parser.continueExpression(reference);
  if (argument !== reference) {
    parser.report(parserDiagnostics.misplacedReference(parser.textSpanOf(reference.span)));
  } else if (!isPlace(reference.expression)) {
    parser.report(
      parserDiagnostics.referenceNotPlace(parser.textSpanOf(reference.expression.span)),
    );
  }
  return argument;
}

export const callParselet: InfixParselet = {
  level: 'postfix',
  parse: (parser, left) => parseCall(parser, left, false, []),
};

export const indexParselet: InfixParselet = {
  level: 'postfix',
  parse: (parser, left) => parseIndex(parser, left, false),
};

/** `a[i]`, or `a?.[i]` after its `?.`, at the `[`. */
function parseIndex(parser: Parser, target: Expression, isOptional: boolean): Index {
  const index = parseEnclosed(parser, '[', () => parser.expression()).value;
  return {
    kind: 'Index',
    span: parser.spanFrom(parser.startOf(target)),
    target,
    isOptional,
    index,
  };
}

export const memberParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    parser.cursor.advance();
    return parseMember(parser, left, false);
  },
};

/** `a?.b`, `f?.(…)` calling the function inside an optional, or `a?.[i]` indexing one. */
export const optionalParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    parser.cursor.advance();
    if (parser.cursor.at('(')) {
      return parseCall(parser, left, true, []);
    }
    return parser.cursor.at('[') ? parseIndex(parser, left, true) : parseMember(parser, left, true);
  },
};

/** `x->f`, or `x?->f` when `isOptional`: a member of the value behind `x`. */
export function arrowParselet(isOptional: boolean): InfixParselet {
  return {
    level: 'postfix',
    parse(parser, left) {
      parser.cursor.advance();
      const operand: Dereference = {
        kind: 'Dereference',
        span: parser.spanFrom(parser.startOf(left)),
        operator: '->',
        operand: left,
        isOptional,
      };
      return parseMember(parser, operand, false);
    },
  };
}

/** The member or tuple element of `target` named after its `.`, `?.` or `->`. */
function parseMember(parser: Parser, target: Expression, isOptional: boolean): Expression {
  const { kind } = parser.cursor;
  if (kind === 'integer' || kind === 'float') {
    return parseTupleElements(parser, target, isOptional);
  }
  const member = parser.identifier('a member name');
  const span = parser.spanFrom(parser.startOf(target));
  return { kind: 'MemberAccess', span, target, isOptional, member };
}

/** Decimal positions only: `t.0`, `t.12`, and `t.0.1` read as one token. */
const tupleElementText = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/u;

/** The tuple element (or two, from a float token) after a `.` or `?.`, at the number. */
function parseTupleElements(parser: Parser, left: Expression, isOptional: boolean): Expression {
  const token = parser.cursor.advance();
  const text = parser.textOf(token);
  if (!tupleElementText.test(text)) {
    parser.report(parserDiagnostics.invalidTupleElement(token.span, text));
    return { kind: 'Invalid', span: parser.spanFrom(parser.startOf(left)) };
  }
  const [first, second] = text.split('.');
  const firstEnd = token.span.start + (first?.length ?? 0);
  const outer: Expression = {
    kind: 'TupleElement',
    span: parser.anchor({ start: parser.startOf(left), end: firstEnd }),
    target: left,
    isOptional,
    element: Number(first),
  };
  if (second === undefined) {
    return outer;
  }
  const span = parser.spanFrom(parser.startOf(left));
  return {
    kind: 'TupleElement',
    span,
    target: outer,
    isOptional: false,
    element: Number(second),
  };
}

export const propagateParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    parser.cursor.advance();
    return { kind: 'Propagate', span: parser.spanFrom(parser.startOf(left)), operand: left };
  },
};

export const unwrapParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    parser.cursor.advance();
    return { kind: 'Unwrap', span: parser.spanFrom(parser.startOf(left)), operand: left };
  },
};

export const structLiteralParselet: InfixParselet = {
  level: 'postfix',
  parse(parser, left) {
    const path = qualifiedPath(left);
    return path === undefined
      ? undefined
      : parseStructLiteralBody(parser, namedTypeFrom(parser, path, []), parser.startOf(left));
  },
};
