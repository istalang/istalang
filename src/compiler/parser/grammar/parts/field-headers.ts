/**
 * A field loop's header (§4), which a field loop, an array comprehension and a struct
 * comprehension share: over a value's fields, `for key, value in ...x`, or over a type's keys,
 * `for K in keyof S`. What follows `in` tells them from iterating an `Iterable`: the `...`, or the
 * word `keyof`, which no expression starts with. So each reads its targets and `in` as `for` does,
 * then this the rest.
 *
 * A loop over a type's keys declares its key as a member parameter (§3.5), so its header is that
 * parameter, `K in keyof S`, as a mapped entry's is: its one target is its name.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { FieldHeader, FieldLoopHeader } from '../../../syntax/expressions/index.ts';
import type { Pattern } from '../../../syntax/patterns.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import type { Parser } from '../../parser.ts';

/** Whether a field loop's header goes on after `in`: at its `...` or its `keyof`. */
export function atFieldLoopSource(parser: Parser): boolean {
  return parser.cursor.at('...') || parser.atWord('keyof');
}

/** A field loop's header from what follows `in`, the targets before it parsed. */
export function parseFieldLoopHeaderAfter(
  parser: Parser,
  start: number,
  targets: readonly Pattern[],
): FieldLoopHeader {
  return parser.atWord('keyof')
    ? parseKeysHeader(parser, targets)
    : parseFieldsHeader(parser, start, targets);
}

/**
 * A field loop visits every field, so its header takes no `if`: one written is read, so recovery
 * goes on past it, then reported once and left out of the tree.
 */
function refuseCondition(parser: Parser): void {
  const condition = parser.cursor.eat('if');
  if (condition !== undefined) {
    parser.expression();
    parser.report(parserDiagnostics.fieldLoopCondition(parser.textSpanFrom(condition.span.start)));
  }
}

/**
 * The name a field loop's header gives its key, if a name: what a struct comprehension's brackets
 * hold.
 */
export function fieldLoopKeyName(header: FieldLoopHeader): string | undefined {
  return header.kind === 'TypeParameter' ? header.name.text : plainName(header.key)?.text;
}

/**
 * `...x`, after a value's targets: exactly a key, a name or `_`, and a value; more or fewer are
 * reported, and a target left out, empty where the written targets end, or a key that is neither,
 * reads as `_`, so nothing after the parser reports it again.
 */
function parseFieldsHeader(
  parser: Parser,
  start: number,
  targets: readonly Pattern[],
): FieldHeader {
  parser.expect('...');
  const subject = parser.expression();
  const span = parser.spanFrom(start);
  refuseCondition(parser);
  const [key, value] = targets;
  if (targets.length !== 2 || key === undefined || value === undefined) {
    parser.report(parserDiagnostics.fieldLoopTargets(parser.textSpanFrom(start)));
  }
  const last = targets.at(-1)?.span;
  const missing = {
    kind: 'WildcardPattern',
    span: last === undefined ? parser.placeholder().span : { ...last, from: last.to },
  } as const;
  const keyTarget = key ?? missing;
  const isKey = plainName(keyTarget) !== undefined || keyTarget.kind === 'WildcardPattern';
  if (!isKey) {
    parser.report(parserDiagnostics.fieldLoopKey(parser.textSpanOf(keyTarget.span)));
  }
  const keyRead: Pattern = isKey ? keyTarget : { kind: 'WildcardPattern', span: keyTarget.span };
  return { kind: 'FieldHeader', span, key: keyRead, value: value ?? missing, subject };
}

/**
 * `keyof S`, after one target, its key's name: the member parameter `K in keyof S`. Any other
 * targets are reported, a missing one already was, and the key then has no name, so nothing after
 * the parser reports it again.
 */
function parseKeysHeader(parser: Parser, targets: readonly Pattern[]): TypeParameter {
  const [first] = targets;
  const written = targets.length === 1 && first !== undefined ? plainName(first) : undefined;
  const at = first?.span ?? parser.placeholder().span;
  const last = targets.at(-1);
  if (
    written === undefined &&
    first !== undefined &&
    last !== undefined &&
    first.kind !== 'Missing'
  ) {
    const { end } = parser.textSpanOf(last.span);
    parser.report(parserDiagnostics.typeLoopKey({ start: parser.startOf(first), end }));
  }
  const name: Identifier = written ?? {
    kind: 'Identifier',
    span: { ...at, to: at.from },
    text: '',
  };
  const memberOf = parser.type();
  if (memberOf.kind !== 'KeyofType') {
    parser.report(parserDiagnostics.typeLoopKeys(parser.textSpanOf(memberOf.span)));
  }
  const span = parser.spanFrom(parser.startOf(first ?? memberOf));
  refuseCondition(parser);
  return {
    kind: 'TypeParameter',
    variance: undefined,
    span,
    isPack: false,
    name,
    memberOf,
    constraints: [],
    defaultType: undefined,
  };
}

/** The one name `target` is, written plainly; undefined for any other target. */
function plainName(target: Pattern): Identifier | undefined {
  return target.kind === 'NamePattern' &&
    target.path.length === 1 &&
    target.typeArguments.length === 0
    ? target.path[0]
    : undefined;
}
