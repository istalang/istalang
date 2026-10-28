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

import type {
  ChainedComparison,
  Expression,
  Range,
  Reference,
} from '../../syntax/expressions/index.ts';
import {
  type BinaryOperator,
  type BinaryOperatorEntry,
  binaryOperators,
  bindingPower,
  isChainOperator,
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

/** A prefix operator just consumed: where it starts, and how it is spelled. */
interface Prefix {
  readonly start: number;
  readonly spelling: string;
}

/** Consumes a prefix operator, reporting it if it binds looser than its position allows. */
function advancePrefix(parser: Parser, level: PrecedenceLevel, minLevel: PrecedenceLevel): Prefix {
  const token = parser.cursor.advance();
  if (bindingPower(level) < bindingPower(minLevel)) {
    parser.report(parserDiagnostics.operatorNeedsParentheses(token.span, token.kind));
  }
  return { start: token.span.start, spelling: token.kind };
}

/**
 * The operand of `prefix`, at the operator's own level, so `- -a` nests; reported when it is an
 * operator a prefix may not stand directly before (§3.9). Only the tight prefixes can be read
 * either way: `not a ** b` can only be `not (a ** b)`.
 */
function prefixOperand(parser: Parser, prefix: Prefix, level: PrecedenceLevel): Expression {
  const operand = parser.expression(level);
  if (operand.kind === 'Binary' && level === 'prefix') {
    const entry: BinaryOperatorEntry = binaryOperators[operand.operator];
    if (entry.refusesPrefixedLeft === true) {
      parser.report(
        parserDiagnostics.prefixBeforePower(parser.spanFrom(prefix.start), prefix.spelling),
      );
    }
  }
  return operand;
}

/** A prefix operator building a `Unary` node. */
export function unaryParselet(operator: UnaryOperator): PrefixParselet {
  const { level } = unaryOperators[operator];
  return (parser, minLevel) => {
    const prefix = advancePrefix(parser, level, minLevel);
    const operand = prefixOperand(parser, prefix, level);
    return { kind: 'Unary', span: parser.spanFrom(prefix.start), operator, operand };
  };
}

export const parseDereference: PrefixParselet = (parser, minLevel) => {
  const prefix = advancePrefix(parser, operatorLevels.dereference, minLevel);
  const operand = prefixOperand(parser, prefix, operatorLevels.dereference);
  return { kind: 'Dereference', span: parser.spanFrom(prefix.start), operator: '*', operand };
};

/** `**x` before an operand: the value behind the value behind `x`, two dereferences in one token. */
export const parseDoubleDereference: PrefixParselet = (parser, minLevel) => {
  const { start } = advancePrefix(parser, operatorLevels.dereference, minLevel);
  const operand = prefixOperand(parser, { start, spelling: '*' }, operatorLevels.dereference);
  const inner: Expression = {
    kind: 'Dereference',
    span: { start: start + 1, end: operand.span.end },
    operator: '*',
    operand,
  };
  return { kind: 'Dereference', span: parser.spanFrom(start), operator: '*', operand: inner };
};

export const parseAwait: PrefixParselet = (parser, minLevel) => {
  const prefix = advancePrefix(parser, operatorLevels.await, minLevel);
  if (parser.cursor.at('select')) {
    return parseSelectFrom(parser, prefix.start, true);
  }
  const operand = prefixOperand(parser, prefix, operatorLevels.await);
  return { kind: 'Await', span: parser.spanFrom(prefix.start), operand };
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
  const { start } = advancePrefix(parser, operatorLevels.range, minLevel);
  return parseRangeRest(parser, start, undefined, isInclusive);
};

/** A range's end and `by` step, after its `..` or `..=`. */
function parseRangeRest(
  parser: Parser,
  start: number,
  first: Expression | undefined,
  isInclusive: boolean,
): Range {
  const end = parseRangeEnd(parser, isInclusive);
  const step = parser.atWord('by') ? parseRangeStep(parser) : undefined;
  return { kind: 'Range', span: parser.spanFrom(start), start: first, isInclusive, end, step };
}

/** A range's end, unless `by` follows the `..` at once: `by` is a word only a range reads. */
function parseRangeEnd(parser: Parser, isInclusive: boolean): Expression | undefined {
  if (parser.startsExpression() && !parser.atWord('by')) {
    return parser.expression(tighterLevel(operatorLevels.range));
  }
  return isInclusive ? parser.missing('the end of an inclusive range') : undefined;
}

/** `by step`, binding as a range's end does. */
function parseRangeStep(parser: Parser): Expression {
  parser.cursor.advance();
  return parser.expression(tighterLevel(operatorLevels.range));
}

export function rangeParselet(isInclusive: boolean): InfixParselet {
  return {
    level: operatorLevels.range,
    parse(parser, left) {
      parser.cursor.advance();
      return parseRangeRest(parser, left.span.start, left, isInclusive);
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
  return {
    level: binaryOperators[operator].level,
    parse(parser, left) {
      parser.cursor.advance();
      return parseBinaryRest(parser, left, operator);
    },
  };
}

/** `not in`, starting at the `not` that follows an operand. */
export const notInParselet: InfixParselet = {
  level: binaryOperators['not in'].level,
  parse(parser, left) {
    parser.cursor.advance();
    parser.expect('in');
    return parseBinaryRest(parser, left, 'not in');
  },
};

/**
 * The right operand of `operator`, its operator just consumed, and the node they make: a `Binary`,
 * or a link added to a chain of comparisons.
 */
function parseBinaryRest(parser: Parser, left: Expression, operator: BinaryOperator): Expression {
  const entry: BinaryOperatorEntry = binaryOperators[operator];
  const right = parser.expression(rightOperandLevel(operator));
  reportMixed(parser, operator, entry.refusesUnparenthesized ?? [], [left, right]);
  const span = parser.spanFrom(left.span.start);
  const chain = isChainOperator(operator) ? comparisonsOf(left) : undefined;
  if (chain !== undefined && isChainOperator(operator)) {
    return {
      kind: 'ChainedComparison',
      span,
      operands: [...chain.operands, right],
      operators: [...chain.operators, operator],
    };
  }
  return { kind: 'Binary', span, left, operator, right };
}

/** The comparisons `node` makes, unparenthesized, which a further comparison extends into a chain. */
function comparisonsOf(
  node: Expression,
): Pick<ChainedComparison, 'operands' | 'operators'> | undefined {
  if (node.kind === 'ChainedComparison') {
    return node;
  }
  return node.kind === 'Binary' && isChainOperator(node.operator)
    ? { operands: [node.left, node.right], operators: [node.operator] }
    : undefined;
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
