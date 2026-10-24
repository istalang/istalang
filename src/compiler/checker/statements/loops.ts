/**
 * Loops (§4): `while` and the `break` and `continue` that leave its body. A loop is a statement of
 * type `unit`; its body runs for its effects, so the body's value is discarded.
 */

import type { NodeOf } from '../../syntax/node.ts';
import { tailNodeOf, type While } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { refuseHeldFuture } from '../rules/futures.ts';
import { boolType, neverType, type Type, unitType } from '../types/type.ts';

/** How deep inside loops checking is, so `break` and `continue` know whether they may stand. */
export class LoopScope {
  #depth = 0;

  /** Runs `check` inside a loop's body. */
  inside<Result>(check: () => Result): Result {
    this.#depth += 1;
    try {
      return check();
    } finally {
      this.#depth -= 1;
    }
  }

  get active(): boolean {
    return this.#depth > 0;
  }
}

export function checkWhile(context: BodyContext, node: While): Type {
  context.expect(node.condition, boolType);
  const body = context.loops.inside(() => context.block(node.body));
  refuseHeldFuture(context.checker, context.module, tailNodeOf(node.body), body);
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
