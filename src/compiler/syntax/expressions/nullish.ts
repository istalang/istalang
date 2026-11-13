/**
 * `a ?? b` and `a!` (§4), read as one form for every phase that gives them meaning: the value inside
 * an operand that may hold `none`, and what stands in for its `none`.
 *
 * - `a!` is `a ?? panic(…)`, so its stand-in is a panic. It is no call written here: a local
 *   `panic` may shadow the prelude's (§3.4), so the checker finds the prelude's itself.
 * - The operator is kept as written, for what reports the operand.
 */

import type { Binary, Expression, Unwrap } from './index.ts';

/** `a ?? b` or `a!`, read alike. */
interface Nullish {
  readonly operand: Expression;
  readonly operator: string;
  readonly orElse: NoneStandIn;
}

/** What stands in for an operand's `none`: `??`'s right side, or `!`'s panic. */
type NoneStandIn =
  | { readonly kind: 'value'; readonly value: Expression }
  | { readonly kind: 'panic' };

/** `node`, a `??` or a `!`, as the one form both read as. */
export function nullishOf(node: Binary | Unwrap): Nullish {
  return node.kind === 'Unwrap'
    ? { operand: node.operand, operator: '!', orElse: { kind: 'panic' } }
    : { operand: node.left, operator: node.operator, orElse: { kind: 'value', value: node.right } };
}
