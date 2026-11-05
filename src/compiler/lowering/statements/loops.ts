/**
 * Loops and labelled blocks (§3.4, §4): `while` tests its condition at the top; `continue` jumps
 * back to the test and `break` past the loop, both ending the blocks they leave as their ends
 * would. A `for` runs the loop every iterating construct runs (iteration.ts), binding its targets
 * to each item; `continue` goes on to the next item. A field loop is written out once per field. A labelled `break` or `continue` goes to the
 * loop the checker found its label naming (CheckedBody `labels`). A labelled block is a block a
 * `hold` may name.
 *
 * Each pass of a `while` is a scope of its own: the `is` bindings of its condition live through
 * its body and end with the pass, and the condition's temporaries end before the body (§3.4, §7).
 * A labelled loop or block some `hold` names keeps a list around it (holds.ts).
 */

import { withPushed } from '../../../structures/stack.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type {
  Break,
  Continue,
  FieldLoop,
  For,
  LabelledBlock,
  LabelledScope,
  Loop,
  While,
} from '../../syntax/statements.ts';
import type { Label } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { tupleOf } from '../expressions/tuples.ts';
import { emitLoopOver } from '../iteration.ts';
import { endScope, lowerGuarded } from './scopes.ts';
import { bindTargets } from './variables.ts';

/** Where `break` and `continue` go inside a loop, and how many blocks were open around it. */
export interface LoopTargets {
  readonly exit: Label;
  readonly next: Label;
  readonly depth: number;
}

/** A loop being lowered: the loop, and where its exits go. */
interface LoweredLoop {
  readonly loop: Loop;
  readonly targets: LoopTargets;
}

/** The loops being lowered, innermost last. */
export class LoopStack {
  readonly #loops: LoweredLoop[] = [];

  /** Lowers `body` as `loop`'s, with `break` and `continue` going to `targets`. */
  inside(loop: Loop, targets: LoopTargets, body: () => void): void {
    withPushed(this.#loops, { loop, targets }, body);
  }

  /** The targets of `loop`, which `exit` leaves. */
  of(loop: LabelledScope | undefined, exit: Break | Continue): LoopTargets {
    const lowered = this.#loops.findLast((each) => each.loop === loop);
    if (lowered === undefined) {
      unreachable(`A loop exit at ${exit.span.from} leaves no loop being lowered.`);
    }
    return lowered.targets;
  }
}

export function lowerWhile(context: FunctionContext, node: While): void {
  context.holds.lowerScope(node, () => {
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
  context.holds.lowerScope(node, () => {
    emitLoopOver(context, node, (targets) => {
      context.loops.inside(node, targets, () => {
        context.block(node.body);
      });
    });
  });
}

/**
 * A field loop (§4): its body written out once per field of its subject's struct, in name order,
 * each pass reading the body as that field's pass checked it, its key and value bound to the
 * field's name and a copy of its value; `continue` goes on to the next field, `break` past the
 * last. The subject is a struct of a known type once instantiated, so nothing is left to run time.
 */
export function lowerFieldLoop(context: FunctionContext, node: FieldLoop): void {
  const { code } = context;
  const { header, span } = node;
  context.holds.lowerScope(node, () => {
    const subject = context.expression(header.subject);
    const fields =
      context.checker.fieldsOf(context.typeOf(header.subject)) ??
      unreachable(
        `A field loop at ${span.from} runs over no struct; the checker should have said so.`,
      );
    const exit = code.newLabel();
    const { depth } = context.variables;
    for (const [position, field] of fields.entries()) {
      const next = code.newLabel();
      context.inFieldPass(header, field.name, () => {
        const { scope } = context.variables.inBlock(() => {
          const key = context.constant(field.name, span);
          const value = code.field(subject, position, span);
          bindTargets(context, header, tupleOf(context, [key, value], span), span);
          context.loops.inside(node, { exit, next, depth }, () => {
            context.block(node.body);
          });
        });
        endScope(context, scope, span);
      });
      code.place(next);
    }
    code.place(exit);
  });
}

/** A labelled block: its body, for its effects, inside its hold scope. */
export function lowerLabelledBlock(context: FunctionContext, node: LabelledBlock): void {
  context.holds.lowerScope(node, () => {
    context.block(node.body);
  });
}

/** `break` or `continue`: leaving the blocks inside the loop ends them, as their ends would. */
export function lowerLoopExit(context: FunctionContext, node: Break | Continue): void {
  const targets = context.loops.of(context.body.labels.exitOf(node), node);
  endScope(context, context.variables.scopeSince(targets.depth), node.span);
  context.code.jump(node.kind === 'Break' ? targets.exit : targets.next, node.span);
}
