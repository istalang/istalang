/**
 * Places that change (§3.4, §3.7): what an assignment to a part, a `&` argument, or a method
 * taking `&self` may change, and the variables each change counts against.
 *
 * - A place is a variable, or a field, tuple element or indexed element of one, at any depth
 *   (syntax `isPlace`, by which the parser reports a target or `&` argument that is none). Its
 *   root decides: a `let` may change, and so may a reference parameter, which changes the caller's
 *   place. A by-value parameter is as if declared `const` (§3.3), and a `const`, top-level or
 *   local, is deeply immutable, so no part of either may change; neither may a pattern's or loop's
 *   binding or an extern constant (§3.6).
 * - A change counts as the root `let` being changed, so it isn't warned about as never reassigned.
 *   A reference marks its root as referenced, which lowering gives storage a reference can reach,
 *   and so does an element written, since its `setIndex` takes the container by `&`.
 * - Writing an indexed element (`xs[i] = v`, `&m[k]`, `a[i].b = v`) reads it with the `index`
 *   its indexing resolved and writes it back with `setIndex(&container, key, element)`, found like
 *   an operator's function, so any type with a `setIndex` takes element writes (§3.7, §3.9). Each
 *   indexed step of a changing place records its `setIndex`, and both functions must run at once
 *   (collection-functions.ts).
 * - An element passed by `&` is copied in before its call and written back when the call returns
 *   (§3.7). An async call returns its future before its callee ends, so an element can't be passed
 *   by `&` to an async function. And a copy can't change together with another place of its
 *   variable, so two places of one variable passed by `&` to one call may not reach through an
 *   element: keys are known only when the program runs, so any two such places count.
 * - A `$` value is a place too (§3.9): assigning to part of it (`x$.f = v`, `x$ += v`) reads it
 *   with the `unwrap` its `x$` calls and writes it back changed with `rewrap(x, value)`, found as
 *   `x$ = v` finds it and recorded as the `x$`'s write, as an element's `setIndex` is. Passing it,
 *   or part of it, by `&` stays on the frontier.
 */

import { rewrapFunction } from '../../../language/well-known.ts';
import type { VariableEntity, VariableOwner } from '../../binder/entities.ts';
import {
  type Expression,
  type Index,
  isPlace,
  placePath,
  type Unwrap,
} from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { frontier } from '../frontier.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import type { Passing } from '../resolution/choice.ts';
import { implicitCall } from '../resolution/implicit.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { runsAtOnce, writeElement } from './collection-functions.ts';

/** Why a place is to change: assigned to, or passed by `&` (explicitly, or as `&self`). */
export type PlaceUse = 'assigned' | 'referenced';

/**
 * Checks `node` as a place that will change; its type, read as the place's value, so lowering
 * finds every part of it typed. A variable assigned as a whole is the assignment's own rule
 * (statements/assignments.ts).
 */
export function checkChangedPlace(context: BodyContext, node: Expression, use: PlaceUse): Type {
  if (isOnFrontier(rootOf(node), use)) {
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
 * Checks that `node`, already checked as a value, may change as a place; false after a report, or
 * for no place, which the parser reported. The receiver of a method taking `&self` is checked this
 * way once the method is known.
 */
function changePlace(context: BodyContext, node: Expression, use: PlaceUse): boolean {
  const root = rootOf(node);
  if (root.kind === 'Unwrap') {
    if (use === 'referenced') {
      context.unsupported(root, frontier.unwrapPart);
      return false;
    }
    return writesAccessors(context, node);
  }
  if (root.kind !== 'Identifier') {
    return false;
  }
  const passedByReference = use === 'referenced' || reachesElement(node);
  return requireChangeable(context, root, passedByReference) && writesAccessors(context, node);
}

/** What the places a call passes by `&` are checked against: the callee's parameters and kind. */
export interface ReferencingCallee {
  readonly name: string;
  readonly isAsync: boolean;
  readonly slots: readonly { readonly reference: boolean }[];
}

/**
 * Checks the places `written` passes by `&` against copying elements in and out (§3.7): none
 * reaches through an element when the callee is async, and no two of one variable when either
 * does.
 */
export function checkReferencedPlaces(
  context: BodyContext,
  written: readonly { readonly node: Expression; readonly passing: Passing }[],
  callee: ReferencingCallee,
): void {
  const places = written.flatMap((argument, position) => {
    if (argument.passing === 'value' || callee.slots[position]?.reference !== true) {
      return [];
    }
    return [argument.node.kind === 'Reference' ? argument.node.expression : argument.node];
  });
  places.forEach((place, position) => {
    if (callee.isAsync && reachesElement(place)) {
      context.report(checkerDiagnostics.elementToAsync(place.span, callee.name));
    }
    const variable = rootVariable(context, place);
    const overlapping = places
      .slice(0, position)
      .some(
        (earlier) =>
          rootVariable(context, earlier) === variable &&
          (reachesElement(earlier) || reachesElement(place)),
      );
    if (variable !== undefined && overlapping) {
      context.report(
        checkerDiagnostics.elementOverlap(place.span, variable.name.text, callee.name),
      );
    }
  });
}

/** Whether the place `node` names steps through an indexed element. */
function reachesElement(node: Expression): boolean {
  return placePath(node).steps.some((step) => step.kind === 'Index');
}

/** The variable at the root of the place `node`, if a variable stands there. */
function rootVariable(context: BodyContext, node: Expression): VariableEntity | undefined {
  const { root } = placePath(node);
  const entity = root.kind === 'Identifier' ? context.entityOf(root) : undefined;
  return entity?.kind === 'variable' ? entity : undefined;
}

/**
 * The accessors of the place `node`, the parts it reaches through a pair of calls, outermost
 * first: its `x$` root, then each indexed element.
 */
function accessorsOf(node: Expression): readonly (Unwrap | Index)[] {
  const { root, steps } = placePath(node);
  const elements = steps.filter((step) => step.kind === 'Index');
  return root.kind === 'Unwrap' ? [root, ...elements] : elements;
}

/** Makes the call writing back each accessor of the place `node`; false after a report. */
function writesAccessors(context: BodyContext, node: Expression): boolean {
  return accessorsOf(node).every((accessor) =>
    accessor.kind === 'Unwrap' ? writesBack(context, accessor) : writesElement(context, accessor),
  );
}

/** Makes the `setIndex` writing back the element `node` reads, changed; false after a report. */
function writesElement(context: BodyContext, node: Index): boolean {
  const container = context.typeOf(node.target);
  const key = context.typeOf(node.index);
  return (
    writeElement(context, {
      node,
      role: 'write',
      container,
      key,
      element: context.typeOf(node),
      failure: () =>
        checkerDiagnostics.notIndexAssignable(node.span, typeText(container), typeText(key)),
    }) && runsAtOnce(context, context.callAt(node), node.span)
  );
}

/** Makes the `rewrap` writing back the value the place's `x$` reads, changed; false after a report. */
function writesBack(context: BodyContext, node: Unwrap): boolean {
  const handle = context.typeOf(node.operand);
  const value = context.typeOf(node);
  const made = implicitCall(context, {
    node,
    role: 'write',
    candidates: topLevelCandidates(context.checker, context.module, rewrapFunction, [
      handle,
      value,
    ]),
    arguments: [
      { type: handle, passing: 'value' },
      { type: value, passing: 'value' },
    ],
    failure: () => checkerDiagnostics.notRewrappable(node.span, typeText(handle)),
  });
  return made !== undefined;
}

/**
 * Checks a method's receiver passed as `&self` (§3.7), already checked as a value: it must be a
 * place that may change, so a call's result, say, is reported as needing one.
 */
export function changeReceiver(context: BodyContext, receiver: Expression, method: string): void {
  if (isPlace(receiver)) {
    changePlace(context, receiver, 'referenced');
  } else {
    context.report(checkerDiagnostics.receiverNotPlace(receiver.span, method));
  }
}

function isOnFrontier(root: Expression, use: PlaceUse): boolean {
  return root.kind === 'Unwrap' && use === 'referenced';
}

/**
 * Whether `variable` may change: a `let`, or a parameter taking a reference. Top-level constants
 * are `const`, so the declaration's own keyword decides for them too.
 */
export function isChangeable(context: BodyContext, variable: VariableEntity): boolean {
  const { owner } = variable;
  switch (owner.kind) {
    case 'Parameter':
      return context.variables.isReference(variable);
    case 'VariableDeclaration':
      return owner.isMutable;
    default:
      return false;
  }
}

/** How a message names a variable that may not change: a parameter, or a `const` (§3.3, §3.4). */
export function immutableKind(owner: VariableOwner): string {
  return owner.kind === 'Parameter' ? 'a parameter' : 'a const';
}

/**
 * Reports when the variable at the root of a place may not change, else notes the change, and
 * that the variable is passed by `&` when it is.
 */
function requireChangeable(
  context: BodyContext,
  root: Identifier,
  passedByReference: boolean,
): boolean {
  const entity = context.entityOf(root);
  if (entity?.kind !== 'variable') {
    return false;
  }
  if (!isChangeable(context, entity)) {
    context.report(
      checkerDiagnostics.constantChanged(root.span, root.text, immutableKind(entity.owner)),
    );
    return false;
  }
  context.variables.noteChanged(entity);
  if (passedByReference) {
    context.variables.noteReferenced(entity);
  }
  return true;
}

/**
 * The innermost expression a place's fields and elements are read from: its variable, or
 * whatever else stands there (a call's result, a `$` value), which isn't one.
 */
function rootOf(node: Expression): Expression {
  return placePath(node).root;
}
