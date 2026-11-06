/**
 * Loops and labels (§3.4, §4): `while`, `for`, field loops, the `break` and `continue` that leave
 * their bodies, blocks labelled for `hold`, and the names labels give. A loop or labelled block is
 * a statement of type `Unit`; its body runs for its effects, so the body's value is discarded. What
 * a `for` runs over, and how, is the rule of iteration (rules/loops/iteration.ts).
 *
 * Each `break`, `continue` and `hold(name)` is resolved here, once, and recorded (`LabelTargets`).
 * A label names one scope of its function: it may not repeat a label around it, nor the function's
 * own name, which `hold(name)` names too, so a name never means two things. A label nothing names
 * is a warning, found when its scope ends.
 */

import type {
  Break,
  Continue,
  FieldLoop,
  For,
  Hold,
  LabelledBlock,
  LabelledScope,
  While,
} from '../../syntax/statements/index.ts';
import type { BodyContext, LabelRecord } from '../contexts/body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { checkedFieldPasses, inFieldPasses } from '../rules/loops/field-passes.ts';
import { checkLoopOver } from '../rules/loops/iteration.ts';
import type { Type } from '../types/type/index.ts';
import { boolType, neverType, unitType } from '../types/type/primitives.ts';

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

/**
 * A field loop (§4): its body once per pass over its subject's fields
 * (rules/loops/field-passes.ts).
 */
export function checkFieldLoop(context: BodyContext, node: FieldLoop): Type {
  const { header } = node;
  const passes = checkedFieldPasses(context, header);
  checkScope(context, node, () => {
    inFieldPasses(context, header, passes, () => context.effectBlock(node.body));
  });
  return unitType;
}

/**
 * Checks `scope`'s label and its body (`checkBody`, once unless a field loop's passes run it
 * more), and warns when nothing in the body named the label.
 */
function checkScope(
  context: BodyContext,
  scope: LabelledScope,
  checkBody = () => context.effectBlock(scope.body),
): void {
  const { label } = scope;
  if (label !== undefined) {
    if (context.enclosing.labelled(label) !== undefined) {
      context.report(checkerDiagnostics.repeatedLabel(label.span, label.text));
    } else if (context.enclosing.isOwnName(label)) {
      context.report(checkerDiagnostics.ownNameLabel(label.span, label.text));
    }
  }
  context.enclosing.inside(scope, checkBody);
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
