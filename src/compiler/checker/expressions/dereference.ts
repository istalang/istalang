/**
 * `*x` and `*x = v` (§3.9): the value behind the handle `x`, read and written whole. They are
 * built in, as reading a field is, so they resolve no call: lowering reads and writes the handle's
 * cell. `x->f` is `(*x).f`, and writing a part of `*x` (`x->f = v`, `*x += v`) reads it and writes
 * it back whole, as writing a part of any place reached through a pair of reads and writes does
 * (calls/places.ts).
 *
 * `v` must fit the value `*x` reads, so it is checked against that type first: `none` or a value
 * wrapped into `T?` gets its expected type, and a value that doesn't fit is reported where it is
 * written.
 */

import type { Dereference } from '../../syntax/expressions.ts';
import type { Assignment } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkDereference(context: BodyContext, node: Dereference): Type {
  return valueBehind(context, node) ?? errorType;
}

/** `*target = value`: the place `*target` written whole, the assignment's one part. */
export function checkWholeWrite(context: BodyContext, node: Assignment, target: Dereference): void {
  const read = valueBehind(context, target);
  const type = context.expression(node.value, read);
  const wraps = read === undefined ? 0 : context.fitWritten(type, read, node.value.span);
  context.variables.recordAssigned(node, [{ target, path: [], type, wraps }]);
}

/** The value behind the handle `node` reads through; undefined after a report. */
function valueBehind(context: BodyContext, node: Dereference): Type | undefined {
  const handle = context.expression(node.operand);
  if (handle.kind === 'error') {
    return undefined;
  }
  const state = handle.kind === 'nominal' ? context.checker.stateOf(handle) : undefined;
  if (state === undefined) {
    context.report(checkerDiagnostics.notShared(node.span, typeText(handle)));
  }
  return state;
}
