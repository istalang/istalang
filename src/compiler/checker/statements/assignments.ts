/**
 * Assignments (§3.4, §3.9, §3.15).
 *
 * - A target is a place, or a tuple or struct literal of targets that takes the value apart, with
 *   the same parts a declaration's targets give (patterns/destructuring.ts); several targets are a
 *   tuple of them. Taking a value apart checks the value on its own first, then fits each part to
 *   the place it goes to.
 * - In a struct target, the shorthand `first` assigns the variable `first`, and a struct with one
 *   field takes a positional target, as a literal takes a positional value (§3.1).
 * - Only a `let` is reassigned. A parameter is the function's own copy (§3.1), so it may be too;
 *   a `const`, and a binding a pattern or loop introduces, never is. Changing part of a variable is
 *   the rule of places (rules/places.ts).
 * - A compound assignment `x += y` is `x = x + y` (§3.9): the operator's function is resolved for
 *   the place's type and recorded on the assignment, and its result must fit the place.
 * - `x$ = v` calls `rewrap` (§3.9), recorded on the assignment like any call (expressions/
 *   unwrap.ts); it writes no part.
 * - `_` as a target holds the value without a name, so it records no part to write (§3.4).
 * - Taking a value apart writes each place once: no target is another's place, or a part of it,
 *   so the order the parts are written in never decides a value (§3.15).
 * - What lowering needs is recorded: each place written, with its part of the value.
 */

import {
  type Expression,
  type FieldItem,
  itemValue,
  placePath,
  type StructLiteral,
  unparenthesized,
} from '../../syntax/expressions.ts';
import type { AssignmentOperator } from '../../syntax/operators.ts';
import { type Assignment, destructures } from '../../syntax/statements.ts';
import type { AssignedPart } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { checkRewrap } from '../expressions/unwrap.ts';
import { type OverloadableOperator, resolveOperator } from '../overloads/operators.ts';
import { bodyScope, elementParts, structParts, type ValuePart } from '../patterns/destructuring.ts';
import { checkChangedPlace, isChangeable } from '../rules/places.ts';
import { itemField } from '../rules/struct-items.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

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
    context.variables.recordAssigned(node, isUnnamed(only) ? [] : [{ target: only, path: [] }]);
    return;
  }
  const whole = { type: context.expression(node.value), path: [] };
  const assigning = { context, parts: [] as AssignedPart[] };
  if (more.length === 0) {
    assignTo(assigning, only, whole);
  } else {
    assignElements(assigning, node.targets, whole, node.span);
  }
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
  context.fit(result, place, node.value.span);
  context.variables.recordAssigned(node, [{ target, path: [] }]);
}

/** Taking an assigned value apart: where parts are collected. */
interface Assigning {
  readonly context: BodyContext;
  readonly parts: AssignedPart[];
}

function assignTo(assigning: Assigning, target: Expression, part: ValuePart): void {
  const { context } = assigning;
  const bare = unparenthesized(target);
  switch (bare.kind) {
    case 'Tuple':
      assignElements(assigning, bare.elements, part, bare.span);
      return;
    case 'StructLiteral':
      assignFields(assigning, bare, part);
      return;
    default: {
      const place = assignedPlace(context, bare);
      context.fit(part.type, place, bare.span);
      if (!isUnnamed(bare)) {
        assigning.parts.push({ target: bare, path: part.path });
      }
    }
  }
}

function assignElements(
  assigning: Assigning,
  targets: readonly Expression[],
  part: ValuePart,
  span: Assignment['span'],
): void {
  const parts = elementParts(assigning.context, part, targets.length, span);
  for (const [index, target] of targets.entries()) {
    assignTo(assigning, target, parts[index] ?? part);
  }
}

/**
 * A struct literal of targets: each item's target takes the part of the field it gives, by the
 * rule a literal's items follow (rules/struct-items.ts).
 */
function assignFields(assigning: Assigning, target: StructLiteral, part: ValuePart): void {
  const { context } = assigning;
  const fields = structParts(bodyScope(context), target.type, part.type, target.span);
  for (const item of target.items) {
    if (item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer') {
      const index = fields === undefined ? -1 : itemField(item, fields);
      const field = fields?.[index];
      if (fields !== undefined && field === undefined) {
        reportUnknown(context, item, part.type, fields.length);
      }
      const fieldPart = { type: field?.type ?? errorType, path: [...part.path, index] };
      assignTo(assigning, itemValue(item), fieldPart);
    }
  }
}

/** An item giving no field of the struct a target takes apart. */
function reportUnknown(context: BodyContext, item: FieldItem, type: Type, count: number): void {
  const text = typeText(type);
  context.report(
    item.kind === 'PositionalInitializer'
      ? checkerDiagnostics.positionalNeedsOneField(item.span, text, count)
      : checkerDiagnostics.unknownField(item.name.span, text, item.name.text),
  );
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
  if (!isChangeable(entity.owner)) {
    context.report(checkerDiagnostics.constReassigned(target.span, target.text));
    return errorType;
  }
  context.variables.noteChanged(entity);
  return context.variables.typeOf(entity);
}

function isUnnamed(target: Expression): boolean {
  const bare = unparenthesized(target);
  return bare.kind === 'Identifier' && bare.text === '_';
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

/** How a place on a variable reads, `p.first.0`; undefined for a place on anything else. */
function placeName(target: Expression): string | undefined {
  const { root, steps } = placePath(target);
  if (root.kind !== 'Identifier') {
    return undefined;
  }
  const names = steps.map((step) =>
    step.kind === 'MemberAccess' ? step.member.text : String(step.element),
  );
  return [root.text, ...names].join('.');
}

function overlap(first: string, second: string): boolean {
  return first === second || first.startsWith(`${second}.`) || second.startsWith(`${first}.`);
}

function compoundOperator(operator: Exclude<AssignmentOperator, '='>): OverloadableOperator {
  return operator.slice(0, -1) as OverloadableOperator;
}
