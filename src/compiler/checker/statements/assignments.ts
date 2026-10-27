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

import { type Expression, unparenthesized } from '../../syntax/expressions/index.ts';
import { placePath } from '../../syntax/expressions/places.ts';
import { type CompoundAssignment, compoundOperator } from '../../syntax/operators.ts';
import {
  type Assignment,
  destructures,
  destructuringOf,
  isUnnamedTarget,
} from '../../syntax/statements.ts';
import { binaryApplied, resolveOperator } from '../calls/operators.ts';
import { checkChangedPlace, immutableKind, isChangeable } from '../calls/places.ts';
import type { AssignedPart } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { anyShape, type Shape } from '../patterns/exhaustiveness.ts';
import { bodyScope, type ValuePart } from '../patterns/parts.ts';
import { type Taking, takeApart, takeTargets } from '../patterns/taking.ts';
import { errorType, type Type } from '../types/type.ts';

export function checkAssignment(context: BodyContext, node: Assignment): void {
  const [only, ...more] = node.targets;
  if (only === undefined) {
    return;
  }
  if (more.length === 0 && node.operator !== '=') {
    checkCompound(context, node, only, node.operator);
    return;
  }
  if (more.length === 0 && !destructures(only)) {
    const place = assignedPlace(context, only);
    const type = context.expression(node.value, place);
    const fit = context.fitWritten(type, place, node.value.span);
    context.variables.recordAssigned(
      node,
      isUnnamedTarget(only) ? [] : [{ target: only, path: [], type, fit }],
    );
    return;
  }
  const whole = { type: context.expression(node.value), path: [] };
  const assigning = assigningIn(context);
  takeTargets(assigning, node.targets, whole, node.span);
  checkDistinctPlaces(context, assigning.parts);
  context.variables.recordAssigned(node, assigning.parts);
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

/** Taking an assigned value apart (patterns/walk.ts): where the places written are collected. */
interface Assigning extends Taking<Expression> {
  readonly parts: AssignedPart[];
}

function assigningIn(context: BodyContext): Assigning {
  const assigning: Assigning = {
    scope: bodyScope(context),
    parts: [],
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
  part: ValuePart,
): Shape | undefined {
  const destructuring = destructuringOf(target);
  if (destructuring !== undefined) {
    return takeApart(assigning, destructuring, part);
  }
  const bare = unparenthesized(target);
  const place = assignedPlace(context, bare);
  const fit = context.fitWritten(part.type, place, bare.span);
  if (!isUnnamedTarget(bare)) {
    assigning.parts.push({ target: bare, path: part.path, type: part.type, fit });
  }
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
  const entity = context.entityOf(target);
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

/** Reports a place written twice, or written whole and in part, by one assignment. */
function checkDistinctPlaces(context: BodyContext, parts: readonly AssignedPart[]): void {
  const written: PlaceName[] = [];
  for (const { target } of parts) {
    const place = placeName(target);
    const earlier =
      place === undefined ? undefined : written.find((other) => overlap(other, place));
    if (place !== undefined && earlier !== undefined) {
      context.report(checkerDiagnostics.assignedTwice(target.span, place.text, earlier.text));
    }
    if (place !== undefined) {
      written.push(place);
    }
  }
}

/** A place as its parts name it, the variable or the handle's value first, and as it reads. */
interface PlaceName {
  readonly parts: readonly string[];
  readonly text: string;
}

/**
 * How a place on a variable, `p.first.0`, or behind the handle a variable holds, `x->a` or `*x`,
 * reads; undefined for a place on anything else, and for an indexed element, whose key is known
 * only when running, so its writes simply happen left to right (§3.15). Two variables may hold one
 * handle, which only running tells too.
 */
function placeName(target: Expression): PlaceName | undefined {
  const { root, steps } = placePath(target);
  const names: string[] = [];
  for (const step of steps) {
    if (step.kind === 'Index') {
      return undefined;
    }
    names.push(step.kind === 'MemberAccess' ? step.member.text : String(step.element));
  }
  if (root.kind === 'Identifier') {
    return { parts: [root.text, ...names], text: [root.text, ...names].join('.') };
  }
  if (root.kind !== 'Dereference' || root.operand.kind !== 'Identifier') {
    return undefined;
  }
  const handle = root.operand.text;
  const text = names.length === 0 ? `*${handle}` : `${handle}->${names.join('.')}`;
  return { parts: [`*${handle}`, ...names], text };
}

/** Whether one of two places is the other or a part of it. */
function overlap(first: PlaceName, second: PlaceName): boolean {
  const shorter = first.parts.length <= second.parts.length ? first : second;
  const longer = shorter === first ? second : first;
  return shorter.parts.every((part, index) => longer.parts[index] === part);
}
