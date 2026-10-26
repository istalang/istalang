/**
 * Loops (§4): `while`, `for`, and the `break` and `continue` that leave their bodies. A loop is a
 * statement of type `unit`; its body runs for its effects, so the body's value is discarded.
 * What a `for` runs over, and how, is the rule of iteration (rules/iteration.ts).
 */

import type { NodeOf } from '../../syntax/node.ts';
import type { For, While } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { checkLoopOver } from '../rules/iteration.ts';
import { boolType, neverType, type Type, unitType } from '../types/type.ts';

export function checkWhile(context: BodyContext, node: While): Type {
  context.expect(node.condition, boolType);
  context.loops.inside(node, () => context.effectBlock(node.body));
  return unitType;
}

export function checkFor(context: BodyContext, node: For): Type {
  checkLoopOver(context, node);
  context.loops.inside(node, () => context.effectBlock(node.body));
  return unitType;
}

/** `break` or `continue`: `never`, allowed only inside a loop. */
export function checkLoopExit(context: BodyContext, node: NodeOf<'Break' | 'Continue'>): Type {
  if (!context.loops.active) {
    context.report(
      checkerDiagnostics.outsideLoop(node.span, node.kind === 'Break' ? 'break' : 'continue'),
    );
  }
  return neverType;
}
