/**
 * Loops (§4): `while` tests its condition at the top; `continue` jumps back to the test and
 * `break` past the loop, both releasing the blocks they leave. A `for` runs the loop every
 * iterating construct runs (iteration.ts), binding its targets to each item; `continue` goes on to
 * the next item.
 */

import { withPushed } from '../../../structures/stack.ts';
import type { Span } from '../../../text/span.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { For, While } from '../../syntax/statements.ts';
import type { Label } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { emitLoopOver } from '../iteration.ts';

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
  const body = code.newLabel();
  const exit = code.newLabel();
  code.place(test);
  code.branch(context.expression(node.condition), body, exit, node.condition.span);
  code.place(body);
  context.loops.inside({ exit, next: test, depth: context.variables.depth }, () => {
    context.block(node.body);
  });
  code.jump(test, node.span);
  code.place(exit);
}

export function lowerFor(context: FunctionContext, node: For): void {
  emitLoopOver(context, node, (targets) => {
    context.loops.inside(targets, () => {
      context.block(node.body);
    });
  });
}

/** `break` or `continue`: leaving the blocks inside the loop releases them, as their ends would. */
export function lowerLoopExit(context: FunctionContext, node: NodeOf<'Break' | 'Continue'>): void {
  const targets = context.loops.current(node.span);
  const registers = context.variables.declaredSince(targets.depth);
  if (registers.length > 0) {
    context.code.emit({ kind: 'release', span: node.span, registers: [...registers] });
  }
  context.code.jump(node.kind === 'Break' ? targets.exit : targets.next, node.span);
}
