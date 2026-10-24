/**
 * Values that must be used (§3.3, §3.12, §7): a value whose loss would go unnoticed can't be
 * left as a bare expression. It is awaited, matched, kept in a variable (`_` included) or dropped.
 *
 * Today that is a future, whose unawaited call would run on unseen; a `Result` and a disposable
 * join with their slices. A statement's value is discarded unless it is its block's value, and a
 * block run for its effects, like a loop's body, discards even its last.
 */

import type { NodeOf } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { holdsFuture } from './futures.ts';

/** Reports the statement `node` when the value it discards, of `type`, must be used. */
export function checkDiscarded(context: BodyContext, node: NodeOf<string>, type: Type): void {
  if (holdsFuture(context.checker, type)) {
    context.report(checkerDiagnostics.unusedValue(node.span, typeText(type)));
  }
}
