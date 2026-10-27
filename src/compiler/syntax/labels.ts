/**
 * What a label names (§3.4, §4): a loop, which `break` and `continue` may name, or a block, which
 * only `hold(name)` may. Labels are lexical and never cross a function, and the checker refuses a
 * label repeating an enclosing one, so a name means one scope. Every walk that keeps the scopes
 * around a point (the checker, its flow model, lowering) finds a label's scope by this one rule,
 * and lowering asks which scopes a hold names here rather than keeping a table of its own.
 */

import { memo } from '../../structures/memo.ts';
import type { Identifier } from './node.ts';
import type { For, LabelledBlock, While } from './statements.ts';
import { bodyChildrenOf, type SyntaxNode } from './tree.ts';

/** A scope a label may name. */
export type LabelledScope = For | While | LabelledBlock;

/** The innermost of `scopes`, innermost last, whose label (`labelOf`) is `name`. */
export function scopeLabelled<Scope>(
  scopes: readonly Scope[],
  labelOf: (scope: Scope) => Identifier | undefined,
  name: Identifier,
): Scope | undefined {
  return scopes.findLast((scope) => labelOf(scope)?.text === name.text);
}

const holdScopes = new WeakMap<LabelledScope, boolean>();

/** Whether some `hold(name)` inside `scope`, nested functions aside, names it. */
export function isHoldScope(scope: LabelledScope): boolean {
  const { label } = scope;
  if (label === undefined) {
    return false;
  }
  return memo(holdScopes, scope, () => {
    const pending: SyntaxNode[] = [scope.body];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.kind === 'Hold' && node.label?.text === label.text) {
        return true;
      }
      pending.push(...bodyChildrenOf(node));
    }
    return false;
  });
}
