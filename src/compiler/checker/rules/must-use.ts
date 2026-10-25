/**
 * Values that must be used (§3.3, §3.12, §7): a value whose loss would go unnoticed can't be
 * left as a bare expression. It is awaited or matched, kept in a variable (`_` included) or
 * dropped.
 *
 * - A future must be used because its unawaited call would run on unseen, and a `Result` because
 *   ignoring it ignores a failure. Either one makes a value holding it must-use too, at any depth
 *   (types/held.ts): a `Result?` that `?.` gives, a tuple with a future in it. A disposable joins
 *   with the holders slice.
 * - A statement's value is discarded unless it is its block's value, and a block run for its
 *   effects, like a loop's body, discards even its last.
 * - `drop e` discards `e` on purpose (§7), whatever it is. `drop x` on a variable also releases
 *   the variable, which then can't be used; that waits for the holders slice.
 */

import { wellKnown } from '../../../language/well-known.ts';
import { type Expression, unparenthesized } from '../../syntax/expressions.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { Drop } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { heldType } from '../types/held.ts';
import { type Type, unitType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';
import { futureArgument } from './futures.ts';

/** Reports the statement `node` when the value it discards, of `type`, must be used. */
export function checkDiscarded(context: BodyContext, node: NodeOf<string>, type: Type): void {
  const use = mustUseAs(context, type);
  if (use !== undefined) {
    context.report(checkerDiagnostics.unusedValue(node.span, typeText(type), use));
  }
}

/** `drop e`: checks `e`, whose value is discarded on purpose. */
export function checkDrop(context: BodyContext, node: Drop): Type {
  if (isVariable(context, node.value)) {
    return context.unsupported(node, frontier.dropVariable);
  }
  context.expression(node.value);
  return unitType;
}

/** How a value of `type` must be used, as the message advises; undefined when it may be lost. */
function mustUseAs(context: BodyContext, type: Type): string | undefined {
  const { checker } = context;
  const isFuture = (part: Type) => futureArgument(checker, part) !== undefined;
  const isResult = (part: Type) =>
    wellKnownArguments(checker, wellKnown.result, part) !== undefined;
  const held = heldType(type, (part) => isFuture(part) || isResult(part));
  if (held === undefined) {
    return undefined;
  }
  if (held !== type) {
    // `await` and `?` take only the value itself, not a holder such as a `Result?` or a tuple.
    return 'match it';
  }
  return isFuture(held) ? 'await it' : "match it, pass its Err on with '?'";
}

/** Whether `node` names a variable, which `drop` would release (§7). */
function isVariable(context: BodyContext, node: Expression): boolean {
  const value = unparenthesized(node);
  return value.kind === 'Identifier' && context.entityOf(value)?.kind === 'variable';
}
