/**
 * Loops (§4): `while` tests its condition at the top; `continue` jumps back to the test and
 * `break` past the loop, both ending the blocks they leave as their ends would. A `for` runs the
 * loop every iterating construct runs (iteration.ts), binding its targets to each item; `continue`
 * goes on to the next item.
 *
 * Each pass of a `while` is a scope of its own: the `is` bindings of its condition live through
 * its body and end with the pass, and the condition's temporaries end before the body (§3.4, §7).
 */

import { withPushed } from '../../../structures/stack.ts';
import type { Span } from '../../../text/span.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { For, While } from '../../syntax/statements.ts';
import type { Label } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { emitLoopOver } from '../iteration.ts';
import { endScope, lowerGuarded } from './scopes.ts';

/** Where `break` and `continue` go inside a loop, and how many blocks were open around it. */
export interface LoopTargets {
  readonly exit: Label;
  readonly next: Label;
  readonly depth: number;
}

/** The loops being lowered, innermost last. */
export class LoopStack {
  readonly #loops: LoopTargets[] = [];

  /** Lowers `body` as a loop's, with `break` and `continue` going to `targets`. */
  inside(targets: LoopTargets, body: () => void): void {
    withPushed(this.#loops, targets, body);
  }

  /** The innermost loop's targets; a loop exit outside a loop is the checker's to report. */
  current(span: Span): LoopTargets {
    const innermost = this.#loops.at(-1);
    if (innermost === undefined) {
      throw new Error(
        `A loop exit outside a loop at ${span.start}; the checker should have said so.`,
      );
    }
    return innermost;
  }
}

export function lowerWhile(context: FunctionContext, node: While): void {
  const { code } = context;
  const test = code.newLabel();
  const exit = code.newLabel();
  const { depth } = context.variables;
  code.place(test);
  lowerGuarded(context, {
    header: () => context.expression(node.condition),
    body: () => {
      context.loops.inside({ exit, next: test, depth }, () => {
        context.block(node.body);
      });
    },
    leave: () => {
      code.jump(test, node.span);
    },
    span: node.condition.span,
  });
  code.place(exit);
}

export function lowerFor(context: FunctionContext, node: For): void {
  emitLoopOver(context, node, (targets) => {
    context.loops.inside(targets, () => {
      context.block(node.body);
    });
  });
}

/** `break` or `continue`: leaving the blocks inside the loop ends them, as their ends would. */
export function lowerLoopExit(context: FunctionContext, node: NodeOf<'Break' | 'Continue'>): void {
  const targets = context.loops.current(node.span);
  endScope(context, context.variables.scopeSince(targets.depth), node.span);
  context.code.jump(node.kind === 'Break' ? targets.exit : targets.next, node.span);
}
