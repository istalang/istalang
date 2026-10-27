/**
 * Operator parselets: prefix, binary, `is` and ranges, at the levels of syntax/operators.ts.
 *
 * A prefix operator's operand parses at the operator's own level, so `not not a` and `- -a` nest. A
 * prefix operator that binds more loosely than the operand position it stands in (`a == not b`,
 * `a + ..b`) is still parsed, so the tree shows what was written, but it is reported: the reader
 * can't tell how far it reaches. An operand an operator's entry refuses without parentheses, such as
 * `and` under `??`, is reported for the same reason (§3.9). `..` without an end is the open range
 * `a..`; `..=` always needs one.
 */

import type { Expression, Reference } from '../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  type BinaryOperatorEntry,
  binaryOperators,
  bindingPower,
  operatorLevels,
  type PrecedenceLevel,
  rightOperandLevel,
  tighterLevel,
  type UnaryOperator,
  unaryOperators,
} from '../../syntax/operators.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import { parseSelectFrom } from './branches.ts';
import type { InfixParselet, PrefixParselet } from './parselet.ts';

/** Consumes a prefix operator, reporting it if it binds looser than its position allows. */
function advancePrefix(parser: Parser, level: PrecedenceLevel, minLevel: PrecedenceLevel): number {
  const token = parser.cursor.advance();
  if (bindingPower(level) < bindingPower(minLevel)) {
    parser.report(parserDiagnostics.operatorNeedsParentheses(token.span, token.kind));
  }
  return token.span.start;
}

/** A prefix operator building a `Unary` node, its operand parsed at the operator's own level. */
export function unaryParselet(operator: UnaryOperator): PrefixParselet {
  const { level } = unaryOperators[operator];
  return (parser, minLevel) => {
    const start = advancePrefix(parser, level, minLevel);
    const operand = parser.expression(level);
    return { kind: 'Unary', span: parser.spanFrom(start), operator, operand };
  };
}

export const parseDereference: PrefixParselet = (parser, minLevel) => {
  const start = advancePrefix(parser, operatorLevels.dereference, minLevel);
  const operand = parser.expression(operatorLevels.dereference);
  return { kind: 'Dereference', span: parser.spanFrom(start), operator: '*', operand };
};

export const parseAwait: PrefixParselet = (parser, minLevel) => {
  const start = advancePrefix(parser, operatorLevels.await, minLevel);
  if (parser.cursor.at('select')) {
    return parseSelectFrom(parser, start, true);
  }
  const operand = parser.expression(operatorLevels.await);
  return { kind: 'Await', span: parser.spanFrom(start), operand };
};

/** `&x`, starting at the `&`. Only a call argument may be one; the caller decides. */
export function parseReference(parser: Parser): Reference {
  const { start } = parser.cursor.advance().span;
  const expression = parser.expression(operatorLevels.reference);
  return { kind: 'Reference', span: parser.spanFrom(start), expression };
}

/** `&x` anywhere a call argument doesn't start (§3.7). */
export const parseMisplacedReference: PrefixParselet = (parser) => {
  const reference = parseReference(parser);
  parser.report(parserDiagnostics.misplacedReference(reference.span));
  return reference;
};

/** `..b` and `..=b`, ranges open at the start. */
export const parseOpenRange: PrefixParselet = (parser, minLevel) => {
  const isInclusive = parser.cursor.at('..=');
  const start = advancePrefix(parser, operatorLevels.range, minLevel);
  const end = parseRangeEnd(parser, isInclusive);
  return { kind: 'Range', span: parser.spanFrom(start), start: undefined, isInclusive, end };
};

function parseRangeEnd(parser: Parser, isInclusive: boolean): Expression | undefined {
  if (parser.startsExpression()) {
    return parser.expression(tighterLevel(operatorLevels.range));
  }
  return isInclusive ? parser.missing('the end of an inclusive range') : undefined;
}

export function rangeParselet(isInclusive: boolean): InfixParselet {
  return {
    level: operatorLevels.range,
    parse(parser, left) {
      parser.cursor.advance();
      const end = parseRangeEnd(parser, isInclusive);
      return {
        kind: 'Range',
        span: parser.spanFrom(left.span.start),
        start: left,
        isInclusive,
        end,
      };
    },
  };
}

export const isParselet: InfixParselet = {
  level: operatorLevels.is,
  parse(parser, left) {
    parser.cursor.advance();
    const pattern = parser.pattern();
    return { kind: 'Is', span: parser.spanFrom(left.span.start), subject: left, pattern };
  },
};

export function binaryParselet(operator: BinaryOperator): InfixParselet {
  const entry: BinaryOperatorEntry = binaryOperators[operator];
  return {
    level: entry.level,
    parse(parser, left) {
      parser.cursor.advance();
      const right = parser.expression(rightOperandLevel(operator));
      reportMixed(parser, operator, entry.refusesUnparenthesized ?? [], [left, right]);
      return { kind: 'Binary', span: parser.spanFrom(left.span.start), left, operator, right };
    },
  };
}

/** Reports each operand of `operator` that uses one of `refused` without parentheses (§3.9). */
function reportMixed(
  parser: Parser,
  operator: BinaryOperator,
  refused: readonly string[],
  operands: readonly Expression[],
): void {
  for (const operand of operands) {
    if (operand.kind === 'Binary' && refused.includes(operand.operator)) {
      parser.report(parserDiagnostics.mixedOperators(operand.span, operator, operand.operator));
    }
  }
}
