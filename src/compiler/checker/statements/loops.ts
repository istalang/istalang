/**
 * Loops (§4): `while`, `for`, and the `break` and `continue` that leave their bodies. A loop is a
 * statement of type `unit`; its body runs for its effects, so the body's value is discarded.
 * What a `for` runs over, and how, is the rule of iteration (rules/iteration.ts).
 */

import { withPushed } from '../../../structures/stack.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { For, While } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { checkLoopOver } from '../rules/iteration.ts';
import { boolType, neverType, type Type, unitType } from '../types/type.ts';

/** The loops whose bodies are being checked, innermost last: where `break` and `continue` may stand. */
export class LoopScope {
  readonly #loops: (While | For)[] = [];

  /** Runs `check` inside the body of `loop`. */
  inside<Result>(loop: While | For, check: () => Result): Result {
    return withPushed(this.#loops, loop, check);
  }

  get active(): boolean {
    return this.#loops.length > 0;
  }
}

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
