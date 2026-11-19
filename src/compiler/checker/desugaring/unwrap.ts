/**
 * `a!` (§10.4) is `a ?? panic("Force-unwrapped none.")`: the value inside `a`, or a panic.
 *
 * - The `panic` is the prelude's, bound by the desugaring, whatever a local one shadows (§7.1).
 * - `!` is warned of where it is written, since it panics on `none`, which `??`, `is` and `match`
 *   handle; no core rule says so, so the sugar does.
 * - `??`'s report of an operand that can't be `none` names the `!` written.
 */

import { panicFunction } from '../../../foundation/language/well-known/implicit-calls.ts';
import type { Binary, Unwrap } from '../../syntax/expressions/index.ts';
import { synthesized } from '../contexts/synthesized.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { typeText } from '../types/type/type-text.ts';
import { callOf, preludeName, stringOf } from './core-nodes.ts';
import type { Desugar } from './index.ts';

/** What the panic of a `none` unwrapped says. */
const unwrappedNone = 'Force-unwrapped none.';

export const unwraps: Desugar<Unwrap> = {
  core: (context, node) => {
    const origin = { sugar: node, role: 'core' };
    const { span } = node;
    context.report(checkerDiagnostics.forceUnwrap(span));
    const panic = preludeName(context, origin, panicFunction, span);
    const right = callOf(origin, span, panic, [stringOf(origin, span, unwrappedNone)]);
    const core: Binary = { kind: 'Binary', span, left: node.operand, operator: '??', right };
    return synthesized(origin, core);
  },
  wording: {
    [checkerDiagnostics.needsOptional.code]: (context, diagnostic, { sugar }) =>
      checkerDiagnostics.needsOptional(
        diagnostic.span,
        '!',
        typeText(context.typeOf(sugar.operand)),
      ),
  },
};
