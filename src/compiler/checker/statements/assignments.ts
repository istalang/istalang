/**
 * Assignments (§3.4, §3.9, §3.15).
 *
 * - A target is a place, or a tuple or struct literal of targets that takes the value apart, by
 *   the walk a declaration's targets take (patterns/walk.ts); several targets are a tuple of them.
 *   Taking a value apart checks the value on its own first, then fits each part to the place it
 *   goes to.
 * - In a struct target, the shorthand `first` assigns the variable `first`, and a struct with one
 *   field takes a positional target, as a literal takes a positional value (§3.1).
 * - Only a `let` is reassigned. A parameter is the function's own copy (§3.1), so it may be too;
 *   a `const`, and a binding a pattern or loop introduces, never is. Changing part of a variable is
 *   the rule of places (calls/places.ts).
 * - A compound assignment `x += y` is `x = x + y` (§3.9): the operator's function is resolved for
 *   the place's type and recorded on the assignment, and its result must fit the place.
 * - A value written to an optional place is wrapped into it (§2), whether the whole value, a part
 *   of it or an operator's result, so each part records its own fit.
 * - `*x = v` writes the value behind the handle `x` whole (§3.9; expressions/dereference.ts), as
 *   its one part.
 * - `_` as a target holds the value without a name, so it records no part to write (§3.4).
 * - Taking a value apart writes each place once: no target is another's place, or a part of it,
 *   so the order the parts are written in never decides a value (§3.15).
 * - What lowering needs is recorded: each place written, with its part of the value and its fit.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { Span } from '../../../text/span.ts';
import { type Expression, unparenthesized } from '../../syntax/expressions/index.ts';
import { type CompoundAssignment, compoundOperator } from '../../syntax/operators.ts';
import { type Assignment, destructuringOf, isUnnamedTarget } from '../../syntax/statements.ts';
import { binaryApplied, resolveOperator } from '../calls/operators.ts';
import {
  checkChangedPlace,
  checkDistinctPlaces,
  immutableKind,
  isChangeable,
} from '../calls/places.ts';
import type { AssignedPart } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { anyShape, type Shape } from '../patterns/exhaustiveness.ts';
import { bodyScope, type ValuePart } from '../patterns/parts.ts';
import { type Taking, takeApart, takeTargets } from '../patterns/taking.ts';
import { errorType, type Type, tupleType } from '../types/type.ts';

export function checkAssignment(context: BodyContext, node: Assignment): void {
  const [only, ...more] = node.targets;
  if (only === undefined) {
    return;
  }
  if (more.length === 0 && node.operator !== '=') {
    checkCompound(context, node, only, node.operator);
    return;
  }
  const { expected, places } = prepareTargets(context, node.targets);
  const whole = { type: context.expression(node.value, expected), path: [] };
  const assigning = assigningIn(context, places, node.value.span);
  takeTargets(assigning, node.targets, whole, node.span);
  checkDistinctPlaces(context, assigning.parts);
  context.variables.recordAssigned(node, assigning.parts);
}

/**
 * Checks the leaf places of `targets` in source order and builds the type `targets` expect of the
 * assigned value; undefined when any target gives no type (as for `_`).
 */
function prepareTargets(
  context: BodyContext,
  targets: readonly Expression[],
): { readonly expected: Type | undefined; readonly places: ReadonlyMap<Expression, Type> } {
  const places = new Map<Expression, Type>();
  const [only] = targets;
  const expected =
    targets.length === 1 && only !== undefined
      ? prepareTarget(context, only, places)
      : prepareTupleTargets(context, targets, places);
  return { expected, places };
}

function prepareTarget(
  context: BodyContext,
  target: Expression,
  places: Map<Expression, Type>,
): Type | undefined {
  const destructuring = destructuringOf(target);
  if (destructuring !== undefined) {
    if (destructuring.kind === 'tuple') {
      return prepareTupleTargets(context, destructuring.elements, places);
    }
    for (const item of destructuring.items) {
      prepareTarget(context, item.target, places);
    }
    return undefined;
  }
  const bare = unparenthesized(target);
  if (isUnnamedTarget(bare)) {
    return undefined;
  }
  const place = assignedPlace(context, bare);
  places.set(bare, place);
  return place.kind === 'error' ? undefined : place;
}

function prepareTupleTargets(
  context: BodyContext,
  elements: readonly Expression[],
  places: Map<Expression, Type>,
): Type | undefined {
  const types = elements.map((element) => prepareTarget(context, element, places));
  const known = types.filter((type): type is Type => type !== undefined);
  return known.length === elements.length ? tupleType(known) : undefined;
}

/** `x op= v`: one place, read and written. */
function checkCompound(
  context: BodyContext,
  node: Assignment,
  target: Expression,
  operator: CompoundAssignment,
): void {
  const place = assignedPlace(context, target);
  const operand = context.expression(node.value);
  const result = resolveOperator(context, node, binaryApplied(compoundOperator(operator)), [
    { node: target, type: place },
    { node: node.value, type: operand },
  ]);
  const fit = context.fitWritten(result, place, node.value.span);
  context.variables.recordAssigned(node, [{ target, path: [], type: result, fit }]);
}

/**
 * Taking an assigned value apart (patterns/taking.ts): where the places written are collected. Its
 * parts are positions, since an assignment's targets read no array's items.
 */
interface Assigning extends Taking<Expression, number> {
  readonly parts: AssignedPart[];
  readonly places: ReadonlyMap<Expression, Type>;
  readonly valueSpan: Span;
}

function assigningIn(
  context: BodyContext,
  places: ReadonlyMap<Expression, Type>,
  valueSpan: Span,
): Assigning {
  const assigning: Assigning = {
    scope: bodyScope(context),
    parts: [],
    places,
    valueSpan,
    take: (target, part) => assignPart(context, assigning, target, part),
  };
  return assigning;
}

/**
 * A part of the assigned value going to `target`: taken apart further when it destructures, else
 * fitted to the place it names, which takes any value of its type.
 */
function assignPart(
  context: BodyContext,
  assigning: Assigning,
  target: Expression,
  part: ValuePart<number>,
): Shape | undefined {
  const destructuring = destructuringOf(target);
  if (destructuring !== undefined) {
    return takeApart(assigning, destructuring, part);
  }
  const bare = unparenthesized(target);
  if (isUnnamedTarget(bare)) {
    return anyShape;
  }
  const place = assigning.places.get(bare) ?? unreachable('An assignment target was not prepared.');
  const at = part.path.length === 0 ? assigning.valueSpan : bare.span;
  const fit = context.fitWritten(part.type, place, at);
  assigning.parts.push({ target: bare, path: part.path, type: part.type, fit });
  return anyShape;
}

/**
 * The type of the place `target` names, after checking that it may change. A variable as a whole
 * is reassigned; a part of one changes by the rule of places. A target that is no place at all
 * was reported by the parser.
 */
function assignedPlace(context: BodyContext, written: Expression): Type {
  const target = unparenthesized(written);
  if (target.kind !== 'Identifier') {
    return checkChangedPlace(context, target, 'assigned');
  }
  const entity = context.useEntity(target);
  if (entity === undefined) {
    return errorType;
  }
  if (entity.kind !== 'variable') {
    context.report(checkerDiagnostics.notAssignable(target.span));
    return errorType;
  }
  if (!isChangeable(context, entity)) {
    context.report(
      checkerDiagnostics.constReassigned(target.span, target.text, immutableKind(entity.owner)),
    );
    return errorType;
  }
  context.variables.noteChanged(entity);
  return context.variables.typeOf(entity);
}
