/**
 * Places that change (§3.4, §3.7): what an assignment to a part, a `&` argument, or a method
 * taking `&self` may change, and the variables each change counts against.
 *
 * - A place is a variable, or a field or tuple element of one, at any depth. Its root decides:
 *   a `let` and a parameter may change (a by-value parameter is the function's own copy, and a
 *   reference parameter changes the caller's place); a `const`, top-level or local, is deeply
 *   immutable, so no part of it may change, and neither may a pattern's or loop's binding or an
 *   extern constant (§3.6).
 * - A change counts as the root `let` being changed, so it isn't warned about as never reassigned.
 *   A reference also marks its root as referenced, which lowering gives storage a reference can
 *   reach.
 * - An element of an indexable value (`xs[i]`) and a `$` value are places too; the features that
 *   add indexing and `Shared` lift them from the frontier.
 */

import type { VariableOwner } from '../../binder/entities.ts';
import { type Expression, placePath } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { errorType, type Type } from '../types/type.ts';

/** Why a place is to change: assigned to, or passed by `&` (explicitly, or as `&self`). */
export type PlaceUse = 'assigned' | 'referenced';

/**
 * Checks `node` as a place that will change; its type, read as the place's value, so lowering
 * finds every part of it typed. A variable assigned as a whole is the assignment's own rule
 * (statements/assignments.ts).
 */
export function checkChangedPlace(context: BodyContext, node: Expression, use: PlaceUse): Type {
  if (isOnFrontier(rootOf(node))) {
    changePlace(context, node, use);
    return errorType;
  }
  const type = context.expression(node);
  if (type.kind === 'error') {
    return type;
  }
  return changePlace(context, node, use) ? type : errorType;
}

/**
 * Checks that `node`, already checked as a value, may change as a place; false after a report.
 * The receiver of a method taking `&self` is checked this way once the method is known.
 */
export function changePlace(context: BodyContext, node: Expression, use: PlaceUse): boolean {
  const root = rootOf(node);
  if (root.kind === 'Index') {
    const element = use === 'assigned' ? frontier.elementAssignment : frontier.elementReference;
    context.unsupported(root, element);
    return false;
  }
  if (root.kind === 'Unwrap') {
    context.unsupported(root, frontier.unwrapPart);
    return false;
  }
  if (root.kind !== 'Identifier') {
    context.report(checkerDiagnostics.notPlace(node.span, use));
    return false;
  }
  return requireChangeable(context, root, use);
}

/**
 * Checks a method's receiver passed as `&self` (§3.7), already checked as a value: it must be a
 * place that may change, so a call's result, say, is reported as needing one.
 */
export function changeReceiver(context: BodyContext, receiver: Expression, method: string): void {
  const root = rootOf(receiver);
  if (root.kind === 'Identifier' || isOnFrontier(root)) {
    changePlace(context, receiver, 'referenced');
  } else {
    context.report(checkerDiagnostics.receiverNotPlace(receiver.span, method));
  }
}

function isOnFrontier(root: Expression): boolean {
  return root.kind === 'Index' || root.kind === 'Unwrap';
}

/**
 * Whether a variable its `owner` declares may change: a `let` or a parameter. Top-level constants
 * are `const`, so the declaration's own keyword decides for them too.
 */
export function isChangeable(owner: VariableOwner): boolean {
  return owner.kind === 'Parameter' || (owner.kind === 'VariableDeclaration' && owner.isMutable);
}

/** Reports when the variable at the root of a place may not change, else notes the change. */
function requireChangeable(context: BodyContext, root: Identifier, use: PlaceUse): boolean {
  const entity = context.entityOf(root);
  if (entity?.kind !== 'variable') {
    return false;
  }
  if (!isChangeable(entity.owner)) {
    context.report(checkerDiagnostics.constantChanged(root.span, root.text));
    return false;
  }
  context.variables.noteChanged(entity);
  if (use === 'referenced') {
    context.variables.noteReferenced(entity);
  }
  return true;
}

/**
 * The innermost expression a place's fields and elements are read from: its variable, or
 * whatever else stands there (a call's result, an index, a `$` value), which isn't one.
 */
function rootOf(node: Expression): Expression {
  return placePath(node).root;
}
