/**
 * Loops and labels (§3.4, §4): `while`, `for`, the `break` and `continue` that leave their bodies,
 * blocks labelled for `hold`, and the names labels give. A loop or labelled block is a statement
 * of type `Unit`; its body runs for its effects, so the body's value is discarded. What a `for`
 * runs over, and how, is the rule of iteration (rules/iteration.ts).
 *
 * Each `break`, `continue` and `hold(name)` is resolved here, once, and recorded (`LabelTargets`). A
 * label names one scope of its function: it may not repeat a label around it, nor the function's
 * own name, which `hold(name)` names too, so a name never means two things. A label nothing names
 * is a warning, found when its scope ends.
 */

import type {
  Break,
  Continue,
  For,
  Hold,
  LabelledBlock,
  LabelledScope,
  While,
} from '../../syntax/statements.ts';
import type { BodyContext, LabelRecord } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { checkLoopOver } from '../rules/iteration.ts';
import { boolType, neverType, type Type, unitType } from '../types/type.ts';

export function checkWhile(context: BodyContext, node: While): Type {
  context.expect(node.condition, boolType);
  checkScope(context, node);
  return unitType;
}

export function checkFor(context: BodyContext, node: For): Type {
  checkLoopOver(context, node);
  checkScope(context, node);
  return unitType;
}

export function checkLabelledBlock(context: BodyContext, node: LabelledBlock): Type {
  checkScope(context, node);
  return unitType;
}

/** `break` or `continue`: `Never`, leaving the innermost loop or the one its label names. */
export function checkLoopExit(context: BodyContext, node: Break | Continue): Type {
  const keyword = node.kind === 'Break' ? 'break' : 'continue';
  const { label } = node;
  const target =
    label === undefined ? context.enclosing.innermostLoop : context.enclosing.labelled(label);
  if (target !== undefined) {
    context.labels.recordExit(node, target);
  }
  if (label === undefined) {
    if (target === undefined) {
      context.report(checkerDiagnostics.outsideLoop(node.span, keyword));
    }
  } else if (target === undefined) {
    context.report(checkerDiagnostics.unknownLoopLabel(label.span, keyword, label.text));
  } else if (target.kind === 'LabelledBlock') {
    context.report(checkerDiagnostics.blockLabel(label.span, keyword, label.text));
  }
  return neverType;
}

/** `hold(name)`: names a loop or block around it, or the function itself. */
export function checkHoldScope(context: BodyContext, hold: Hold): void {
  const { label } = hold;
  if (label === undefined || context.enclosing.isOwnName(label)) {
    return;
  }
  const target = context.enclosing.labelled(label);
  if (target === undefined) {
    context.report(checkerDiagnostics.unknownHoldScope(label.span, label.text));
  } else {
    context.labels.recordHold(hold, target);
  }
}

/** Checks `scope`'s label and its body, and warns when nothing in the body named the label. */
function checkScope(context: BodyContext, scope: LabelledScope): void {
  const { label } = scope;
  if (label !== undefined) {
    if (context.enclosing.labelled(label) !== undefined) {
      context.report(checkerDiagnostics.repeatedLabel(label.span, label.text));
    } else if (context.enclosing.isOwnName(label)) {
      context.report(checkerDiagnostics.ownNameLabel(label.span, label.text));
    }
  }
  context.enclosing.inside(scope, () => context.effectBlock(scope.body));
  if (label !== undefined && !context.labels.isNamed(scope)) {
    context.report(checkerDiagnostics.unusedLabel(label.span, label.text));
  }
}

/**
 * The exits and holds of one body, recorded as they are resolved here; the flow model and
 * lowering read them by node, so no other walk finds a label again.
 */
export class LabelTargets implements LabelRecord {
  readonly #exits = new Map<Break | Continue, LabelledScope>();
  readonly #holds = new Map<Hold, LabelledScope>();
  readonly #named = new Set<LabelledScope>();
  readonly #holdScopes = new Set<LabelledScope>();

  recordExit(exit: Break | Continue, target: LabelledScope): void {
    this.#exits.set(exit, target);
    if (exit.label !== undefined) {
      this.#named.add(target);
    }
  }

  recordHold(hold: Hold, target: LabelledScope): void {
    this.#holds.set(hold, target);
    this.#named.add(target);
    this.#holdScopes.add(target);
  }

  isNamed(scope: LabelledScope): boolean {
    return this.#named.has(scope);
  }

  exitOf(exit: Break | Continue): LabelledScope | undefined {
    return this.#exits.get(exit);
  }

  heldUntil(hold: Hold): LabelledScope | undefined {
    return this.#holds.get(hold);
  }

  isHoldScope(scope: LabelledScope): boolean {
    return this.#holdScopes.has(scope);
  }
}
