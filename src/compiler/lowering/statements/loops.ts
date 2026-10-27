/**
 * Loops and labelled blocks (§3.4, §4): `while` tests its condition at the top; `continue` jumps
 * back to the test and `break` past the loop, both ending the blocks they leave as their ends
 * would. A `for` runs the loop every iterating construct runs (iteration.ts), binding its targets
 * to each item; `continue` goes on to the next item. A labelled `break` or `continue` goes to the
 * loop its label names (syntax/labels.ts). A labelled block is a block a `hold` may name.
 *
 * Each pass of a `while` is a scope of its own: the `is` bindings of its condition live through
 * its body and end with the pass, and the condition's temporaries end before the body (§3.4, §7).
 * A labelled loop or block some `hold` names keeps a list around it (holds.ts).
 */

import { withPushed } from '../../../structures/stack.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import { scopeLabelled } from '../../syntax/labels.ts';
import type { Break, Continue, For, LabelledBlock, While } from '../../syntax/statements.ts';
import type { Label } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { emitLoopOver } from '../iteration.ts';
import { lowerHoldScope } from './holds.ts';
import { endScope, lowerGuarded } from './scopes.ts';

/** Where `break` and `continue` go inside a loop, and how many blocks were open around it. */
export interface LoopTargets {
  readonly exit: Label;
  readonly next: Label;
  readonly depth: number;
}

/** A loop being lowered: the loop, and where its exits go. */
interface LoweredLoop {
  readonly loop: For | While;
  readonly targets: LoopTargets;
}

/** The loops being lowered, innermost last. */
export class LoopStack {
  readonly #loops: LoweredLoop[] = [];

  /** Lowers `body` as `loop`'s, with `break` and `continue` going to `targets`. */
  inside(loop: For | While, targets: LoopTargets, body: () => void): void {
    withPushed(this.#loops, { loop, targets }, body);
  }

  /** The targets of the loop `exit` leaves: the innermost, or the one its label names. */
  of(exit: Break | Continue): LoopTargets {
    const { label } = exit;
    const lowered =
      label === undefined
        ? this.#loops.at(-1)
        : scopeLabelled(this.#loops, ({ loop }) => loop.label, label);
    if (lowered === undefined) {
      unreachable(
        `A loop exit at ${exit.span.start} leaves no loop; the checker should have said so.`,
      );
    }
    return lowered.targets;
  }
}

export function lowerWhile(context: FunctionContext, node: While): void {
  lowerHoldScope(context, node, () => {
    lowerWhileLoop(context, node);
  });
}

function lowerWhileLoop(context: FunctionContext, node: While): void {
  const { code } = context;
  const test = code.newLabel();
  const exit = code.newLabel();
  const { depth } = context.variables;
  code.place(test);
  lowerGuarded(context, {
    header: () => context.expression(node.condition),
    body: () => {
      context.loops.inside(node, { exit, next: test, depth }, () => {
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
  lowerHoldScope(context, node, () => {
    emitLoopOver(context, node, (targets) => {
      context.loops.inside(node, targets, () => {
        context.block(node.body);
      });
    });
  });
}

/** A labelled block: its body, for its effects, inside its hold scope. */
export function lowerLabelledBlock(context: FunctionContext, node: LabelledBlock): void {
  lowerHoldScope(context, node, () => {
    context.block(node.body);
  });
}

/** `break` or `continue`: leaving the blocks inside the loop ends them, as their ends would. */
export function lowerLoopExit(context: FunctionContext, node: Break | Continue): void {
  const targets = context.loops.of(node);
  endScope(context, context.variables.scopeSince(targets.depth), node.span);
  context.code.jump(node.kind === 'Break' ? targets.exit : targets.next, node.span);
}
