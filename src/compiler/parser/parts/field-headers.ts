/**
 * A field loop's header (§4), `for key, value in ...x`, which a field loop, an array comprehension
 * and a struct comprehension share: the `...` before its subject tells it from iterating an
 * `Iterable`, so each reads its targets and `in` as `for` does, then this the rest.
 */

import type { FieldHeader } from '../../syntax/expressions/index.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import type { Parser } from '../parser.ts';

/**
 * A field loop's header from its `...` on, the targets before `in` parsed: exactly a key, a name or
 * `_`, and a value; more or fewer are reported, and a target left out, empty where the written
 * targets end, or a key that is neither, reads as `_`, so nothing after the parser reports it again.
 * A field loop visits every field, so its header takes no `if`: one written is read, so recovery
 * goes on past it, then reported once and left out of the tree.
 */
export function parseFieldHeaderAfter(
  parser: Parser,
  start: number,
  targets: readonly Pattern[],
): FieldHeader {
  parser.expect('...');
  const subject = parser.expression();
  const span = parser.spanFrom(start);
  const condition = parser.cursor.eat('if');
  if (condition !== undefined) {
    parser.expression();
    parser.report(parserDiagnostics.fieldLoopCondition(parser.textSpanFrom(condition.span.start)));
  }
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
  const isName =
    keyTarget.kind === 'NamePattern' &&
    keyTarget.path.length === 1 &&
    keyTarget.typeArguments.length === 0;
  const isKey = isName || keyTarget.kind === 'WildcardPattern';
  if (!isKey) {
    parser.report(parserDiagnostics.fieldLoopKey(parser.textSpanOf(keyTarget.span)));
  }
  const keyRead: Pattern = isKey ? keyTarget : { kind: 'WildcardPattern', span: keyTarget.span };
  return { kind: 'FieldHeader', span, key: keyRead, value: value ?? missing, subject };
}
