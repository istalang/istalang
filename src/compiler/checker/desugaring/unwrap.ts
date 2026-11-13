/**
 * `a!` (§4) is `a ?? panic("Force-unwrapped none.")`: the value inside `a`, or a panic.
 *
 * - The `panic` is the prelude's, bound by the desugaring, whatever a local one shadows (§3.4).
 * - `!` is warned of where it is written, since it panics on `none`, which `??`, `is` and `match`
 *   handle; no core rule says so, so the sugar does.
 * - `??`'s report of an operand that can't be `none` names the `!` written.
 */

import { panicFunction } from '../../../foundation/language/well-known/implicit-calls.ts';
import { languageModules } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import type { Binary, Unwrap } from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import { bound, synthesized } from '../contexts/synthesized.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { typeText } from '../types/type/type-text.ts';
import type { Desugar } from './index.ts';

/** What the panic of a `none` unwrapped says. */
const unwrappedNone = 'Force-unwrapped none.';

export const unwraps: Desugar<Unwrap> = {
  core: (context, node) => {
    const origin = { sugar: node, role: 'core' };
    context.report(checkerDiagnostics.forceUnwrap(node.span));
    const prelude = { module: languageModules.prelude, name: panicFunction };
    const panic =
      context.checker.wellKnownEntity(prelude) ?? unreachable("The prelude declares 'panic'.");
    const message = { kind: 'StringLiteral', span: node.span, value: unwrappedNone } as const;
    const call: Call = {
      kind: 'Call',
      span: node.span,
      callee: bound(
        synthesized(origin, { kind: 'Identifier', span: node.span, text: panicFunction }),
        panic,
      ),
      isOptional: false,
      arguments: [synthesized(origin, message satisfies StringLiteral)],
    };
    const right = synthesized(origin, call);
    const core: Binary = {
      kind: 'Binary',
      span: node.span,
      left: node.operand,
      operator: '??',
      right,
    };
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
