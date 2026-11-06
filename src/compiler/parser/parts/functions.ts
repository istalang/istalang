/**
 * What every function form begins with (§3.3, §3.14): its head, `fn` or `async fn`, which lambdas,
 * function types and function declarations share, and the parameter list lambdas and function
 * declarations share: defaults, rest parameters, reference types, which only a parameter's type
 * may have (§3.7), and patterns that take an argument apart.
 *
 * A parameter is a name, or a declaration target (§3.15) read by the pattern grammar, whose
 * `as name` names the whole. A bare name stays a name, never a one-name pattern: the parameter's
 * name has one home (syntax/expressions/index.ts). Whether a pattern can fail, and where a pattern
 * may stand at all, is the checker's to judge; only a rest parameter is a name by its syntax, as
 * `...` collects arguments into one value no pattern is written for.
 */

import type { Parameter, ParameterBinding } from '../../syntax/expressions/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import { parseDelimited } from '../brackets/recovery.ts';
import type { CursorKind } from '../cursor/index.ts';
import type { Parser } from '../parser.ts';
import { spreadOpener } from './spreads.ts';

/** `fn` or `async fn`, starting at either keyword: whether the function is async. */
export function parseFunctionKeyword(parser: Parser): boolean {
  const isAsync = parser.cursor.eat('async') !== undefined;
  parser.expect('fn');
  return isAsync;
}

/** `(a: Int, b = 1, Point{x, y}, ...rest: Array<T>)`, starting at the `(`. */
export function parseParameters(parser: Parser): readonly (Parameter | Invalid)[] {
  return parseDelimited(parser, '(', () => parseParameter(parser)).items;
}

function parseParameter(parser: Parser): Parameter {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const rest = cursor.eat(spreadOpener);
  const binding =
    rest === undefined && startsPattern(parser)
      ? bindingOf(parser.parameterPattern())
      : { name: parser.identifier('a parameter name'), pattern: undefined };
  const type = cursor.eat(':') === undefined ? undefined : parser.parameterType();
  const defaultValue = cursor.eat('=') === undefined ? undefined : parser.expression();
  const span = parser.spanFrom(start);
  return { kind: 'Parameter', span, isRest: rest !== undefined, ...binding, type, defaultValue };
}

/**
 * Whether a pattern, not a plain name, starts at the cursor: anything but a name, or a name a
 * struct pattern's `{`, a qualifier's `.` or type arguments' `<` follows on its line.
 */
function startsPattern(parser: Parser): boolean {
  const { cursor } = parser;
  if (!cursor.at('identifier')) {
    return !missingParameterBefore.has(cursor.kind);
  }
  const next = cursor.kindAt(1);
  return next === '.' || ((next === '{' || next === '<') && !cursor.startsLineInList(1));
}

/** What stands where a parameter is missing: its list's end, or what follows a parameter's name. */
const missingParameterBefore: ReadonlySet<CursorKind> = new Set([',', ')', ':', '=', 'lineBreak']);

/**
 * A parameter's pattern split into the name of the whole, its `as` name, and what it takes apart.
 */
function bindingOf(pattern: Pattern): ParameterBinding {
  return pattern.kind === 'AsPattern'
    ? { name: pattern.name, pattern: pattern.pattern }
    : { name: undefined, pattern };
}
