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
 * - `x$ = v` calls `rewrap` (§3.9), recorded on the assignment like any call (expressions/
 *   unwrap.ts); it writes no part.
 * - `_` as a target holds the value without a name, so it records no part to write (§3.4).
 * - Taking a value apart writes each place once: no target is another's place, or a part of it,
 *   so the order the parts are written in never decides a value (§3.15).
 * - What lowering needs is recorded: each place written, with its part of the value.
 */

import { type Expression, placePath, unparenthesized } from '../../syntax/expressions.ts';
import type { AssignmentOperator } from '../../syntax/operators.ts';
import {
  type Assignment,
  destructures,
  destructuringOf,
  isUnnamedTarget,
} from '../../syntax/statements.ts';
import { type OverloadableOperator, resolveOperator } from '../calls/operators.ts';
import { checkChangedPlace, immutableKind, isChangeable } from '../calls/places.ts';
import type { AssignedPart } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { checkRewrap } from '../expressions/unwrap.ts';
import { anyShape, type Shape } from '../patterns/exhaustiveness.ts';
import { bodyScope, type ValuePart } from '../patterns/parts.ts';
import { type Taking, takeApart, takeTargets } from '../patterns/walk.ts';
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
  if (more.length === 0 && only.kind === 'Unwrap') {
    checkRewrap(context, node, only);
    return;
  }
  if (more.length === 0 && !destructures(only)) {
    const place = assignedPlace(context, only);
    context.expect(node.value, place);
    context.variables.recordAssigned(
      node,
      isUnnamedTarget(only) ? [] : [{ target: only, path: [] }],
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
  operator: Exclude<AssignmentOperator, '='>,
): void {
  const place = assignedPlace(context, target);
  const operand = context.expression(node.value);
  const result = resolveOperator(context, node, compoundOperator(operator), [
    { node: target, type: place },
    { node: node.value, type: operand },
  ]);
  context.fitUnwrapped(result, place, node.value.span);
  context.variables.recordAssigned(node, [{ target, path: [] }]);
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
  context.fitUnwrapped(part.type, place, bare.span);
  if (!isUnnamedTarget(bare)) {
    assigning.parts.push({ target: bare, path: part.path });
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
  const written: string[] = [];
  for (const { target } of parts) {
    const place = placeName(target);
    const earlier =
      place === undefined ? undefined : written.find((other) => overlap(other, place));
    if (place !== undefined && earlier !== undefined) {
      context.report(checkerDiagnostics.assignedTwice(target.span, place, earlier));
    }
    if (place !== undefined) {
      written.push(place);
    }
  }
}

/**
 * How a place on a variable reads, `p.first.0`; undefined for a place on anything else, and for
 * an indexed element, whose key is known only when running, so its writes simply happen left to
 * right (§3.15).
 */
function placeName(target: Expression): string | undefined {
  const { root, steps } = placePath(target);
  const names: string[] = [];
  for (const step of steps) {
    if (step.kind === 'Index') {
      return undefined;
    }
    names.push(step.kind === 'MemberAccess' ? step.member.text : String(step.element));
  }
  return root.kind === 'Identifier' ? [root.text, ...names].join('.') : undefined;
}

function overlap(first: string, second: string): boolean {
  return first === second || first.startsWith(`${second}.`) || second.startsWith(`${first}.`);
}

function compoundOperator(operator: Exclude<AssignmentOperator, '='>): OverloadableOperator {
  return operator.slice(0, -1) as OverloadableOperator;
}
