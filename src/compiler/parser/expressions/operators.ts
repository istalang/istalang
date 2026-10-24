/**
 * Operator parselets: prefix, binary, `is` and ranges, at the levels of syntax/operators.ts.
 *
 * A prefix operator's operand parses at the operator's own level, so `not not a` and `- -a` nest. A
 * prefix operator that binds more loosely than the operand position it stands in (`a == not b`,
 * `a + ..b`) is still parsed, so the tree shows what was written, but it is reported: the reader
 * can't tell how far it reaches. `??` mixed with `and`/`or` without parentheses is reported for the
 * same reason (§3.9). `..` without an end is the open range `a..`; `..=` always needs one.
 */

import type { Expression, Reference } from '../../syntax/expressions.ts';
import {
  type BinaryOperator,
  binaryOperatorLevels,
  bindingPower,
  operatorLevels,
  type PrecedenceLevel,
  tighterLevel,
} from '../../syntax/operators.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';
import type { InfixParselet, PrefixParselet } from './parselet.ts';

/** Consumes a prefix operator, reporting it if it binds looser than its position allows. */
function advancePrefix(parser: Parser, level: PrecedenceLevel, minLevel: PrecedenceLevel): number {
  const token = parser.cursor.advance();
  if (bindingPower(level) < bindingPower(minLevel)) {
    parser.report(parserDiagnostics.operatorNeedsParentheses(token.span, token.kind));
  }
  return token.span.start;
}

export const parseNegation: PrefixParselet = (parser, minLevel) => {
  const start = advancePrefix(parser, operatorLevels.unaryMinus, minLevel);
  const operand = parser.expression(operatorLevels.unaryMinus);
  return { kind: 'Unary', span: parser.spanFrom(start), operator: '-', operand };
};

export const parseNot: PrefixParselet = (parser, minLevel) => {
  const start = advancePrefix(parser, operatorLevels.not, minLevel);
  const operand = parser.expression(operatorLevels.not);
  return { kind: 'Unary', span: parser.spanFrom(start), operator: 'not', operand };
};

export const parseAwait: PrefixParselet = (parser, minLevel) => {
  const start = advancePrefix(parser, operatorLevels.await, minLevel);
  const operand = parser.expression(operatorLevels.await);
  return { kind: 'Await', span: parser.spanFrom(start), operand };
};

/** `&x`, starting at the `&`. Only a call argument may be one; the caller decides. */
export function parseReference(parser: Parser): Reference {
  const { start } = parser.cursor.advance().span;
  const expression = parser.expression(operatorLevels.reference);
  return { kind: 'Reference', span: parser.spanFrom(start), expression };
}

/** `&x` anywhere a call argument doesn't start (gap G11). */
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
  const level = binaryOperatorLevels[operator];
  return {
    level,
    parse(parser, left) {
      parser.cursor.advance();
      const right = parser.expression(tighterLevel(level));
      if (operator === '??') {
        reportMixedLogic(parser, [left, right]);
      }
      return { kind: 'Binary', span: parser.spanFrom(left.span.start), left, operator, right };
    },
  };
}

/** `??` is the loosest level, so only its operands can be unparenthesized `and`/`or`. */
function reportMixedLogic(parser: Parser, operands: readonly Expression[]): void {
  for (const operand of operands) {
    if (operand.kind === 'Binary' && (operand.operator === 'and' || operand.operator === 'or')) {
      parser.report(parserDiagnostics.mixedCoalesce(operand.span));
    }
  }
}
