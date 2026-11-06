/**
 * Places that change (§3.4, §3.7): what an assignment to a part, a `&` argument, or a method
 * taking `&self` may change, and the variables each change counts against.
 *
 * - A place is a variable, or a field, tuple element or indexed element of one, at any depth
 *   (syntax `isPlace`, by which the parser reports a target or `&` argument that is none). A field
 *   a trait requires, read through an `any` value or a type parameter, which may be an `any` type,
 *   is no place: its value's own type, which holds the field, is known only when the program runs
 *   (§3.14). Its root decides: a `let` may change, and so may a reference parameter, which changes the caller's
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
 * - A field a key reads, `s[k]` (§3.9), is a field path, as `s.name` is: no accessor. A key of one
 *   name is one field. A key that may name several is no place to pass by `&`, which would let the
 *   callee write another field's type; a value written to it must fit each field it may name
 *   (`severalKeyedFields`), each through its own conversion.
 * - The value behind a handle, `*x`, is a place too (§3.9): the place starts there, whatever the
 *   handle is read from, since changing it changes what is behind the handle, not the handle.
 *   Changing it (`x->f = v`, `*x += v`, `&*x`) reads it whole and writes it back whole, which
 *   lowering does with the handle's cell, so it needs no call.
 * - An element or a handle's value is an accessor: reached through a pair of reads and writes, it
 *   is a copy for the change. Passed by `&`, it is copied in before its call and written back when
 *   the call returns (§3.7). An async call returns its future before its callee ends, so neither
 *   can be passed by `&` to an async function. And a copy can't change together with another place
 *   it is part of, so two places of one variable passed by `&` to one call may not reach through an
 *   element, keys being known only when the program runs, and two places reaching through handles
 *   may not be passed to one call at all, since two handles may be one.
 */

import type { VariableEntity, VariableOwner } from '../../binder/entities.ts';
import type { Dereference, Expression, Index } from '../../syntax/expressions/index.ts';
import { type PlaceStep, placePath } from '../../syntax/expressions/places.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyContext } from '../body-context.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Passing } from '../resolution/call-arguments.ts';
import type { AssignedPart } from '../surface/checked-body.ts';
import { keyMembers, structConstraintsOn } from '../traits/known-constraints.ts';
import { isOpaque } from '../types/computed-types.ts';
import { errorType } from '../types/primitives.ts';
import type { Type } from '../types/type.ts';
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
  const { root, steps } = placePath(node);
  const throughTrait = steps.find(
    (step) =>
      step.kind === 'MemberAccess' &&
      holdsFieldByTrait(context, context.typeOf(step.target), step.member.text),
  );
  if (throughTrait?.kind === 'MemberAccess') {
    context.report(
      checkerDiagnostics.requiredFieldChanged(throughTrait.member.span, throughTrait.member.text),
    );
    return false;
  }
  if (root.kind === 'Dereference') {
    return writesAccessors(context, node) && referencesOneField(context, steps, use);
  }
  if (root.kind !== 'Identifier') {
    return false;
  }
  const passedByReference = use === 'referenced' || reachesAccessor(context, node);
  return (
    requireChangeable(context, root, passedByReference) &&
    writesAccessors(context, node) &&
    referencesOneField(context, steps, use)
  );
}

/**
 * Whether a place passed by `&` reaches one field wherever a key reads one: a key that may name
 * several is reported (§3.7). An element written past such a key passes its container by `&` to
 * `setIndex`, so it is passed by `&` too.
 */
function referencesOneField(
  context: BodyContext,
  steps: readonly PlaceStep[],
  use: PlaceUse,
): boolean {
  const at = steps.findIndex(
    (step) => step.kind === 'Index' && severalKeyedFields(context, step) !== undefined,
  );
  const several = steps[at];
  if (several?.kind !== 'Index') {
    return true;
  }
  const referenced =
    use === 'referenced' ||
    steps.slice(at + 1).some((step) => step.kind === 'Index' && isElementStep(context, step));
  if (referenced) {
    const key = typeText(context.typeOf(several.index));
    context.report(checkerDiagnostics.severalKeysReferenced(several.index.span, key));
    return false;
  }
  return true;
}

/** Whether `step` reaches an element through its container's `index`, not a field by a key. */
function isElementStep(context: BodyContext, step: Index): boolean {
  return context.fieldReads.of(step) === undefined;
}

/**
 * The fields a value written to `node` must each fit, when a key that may name several reads it
 * (§3.9): the type of each field its key may name. Undefined for any other place, which a value
 * fits as its type says.
 */
export function severalKeyedFields(
  context: BodyContext,
  node: Expression,
): readonly Type[] | undefined {
  if (node.kind !== 'Index' || isElementStep(context, node)) {
    return undefined;
  }
  const { checker } = context;
  const key = context.typeOf(node.index);
  if (isSingleKey(checker, key)) {
    return undefined;
  }
  const container = context.typeOf(node.target);
  return keyMembers(checker, key).map((each) => checker.typeRules.fieldType(container, each));
}

/**
 * Whether a key of type `key` names one field however the program runs: one literal, or a member
 * type parameter, one key per instantiation (§3.5, §3.9).
 */
function isSingleKey(checker: CheckerContext, key: Type): boolean {
  return (
    (key.kind === 'literal' && typeof key.value === 'string') ||
    (key.kind === 'parameter' && checker.fitting.memberUnionOf(key) !== undefined)
  );
}

/**
 * Whether a value of `type` has the field `name` only as a trait requires it: on an `any` type, or
 * on a type known only per instantiation unless a struct constraint names it, which states a
 * struct's own field (§3.5, §3.10).
 */
function holdsFieldByTrait(context: BodyContext, type: Type, name: string): boolean {
  if (type.kind === 'any') {
    return true;
  }
  if (!isOpaque(type)) {
    return false;
  }
  return !structConstraintsOn(context.checker, type).some((model) =>
    model.named.some((entry) => entry.name === name),
  );
}

/** What the places a call passes by `&` are checked against: the callee's parameters and kind. */
export interface ReferencingCallee {
  readonly name: string;
  readonly isAsync: boolean;
  readonly slots: readonly { readonly reference: boolean }[];
}

/**
 * Checks the places `written` passes by `&` against copying accessors in and out (§3.7): none
 * reaches through one when the callee is async, no two of one variable when either reaches through
 * an element, and no two reaching through handles.
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
    if (callee.isAsync && reachesAccessor(context, place)) {
      context.report(checkerDiagnostics.accessorToAsync(place.span, callee.name));
    }
    const earlier = places.slice(0, position);
    const variable = rootVariable(context, place);
    const overlapping = earlier.some(
      (other) =>
        rootVariable(context, other) === variable &&
        (reachesAccessor(context, other) || reachesAccessor(context, place)),
    );
    if (variable !== undefined && overlapping) {
      context.report(
        checkerDiagnostics.elementOverlap(place.span, variable.name.text, callee.name),
      );
    }
    if (throughShared(place) && earlier.some(throughShared)) {
      context.report(checkerDiagnostics.sharedOverlap(place.span, callee.name));
    }
  });
}

/** Whether the place `node` names starts at the value behind a handle. */
function throughShared(node: Expression): boolean {
  return placePath(node).root.kind === 'Dereference';
}

/** Whether the place `node` names reaches through an accessor: a handle's value or an element. */
function reachesAccessor(context: BodyContext, node: Expression): boolean {
  return accessorsOf(context, node).length > 0;
}

/** The variable at the root of the place `node`, if a variable stands there. */
function rootVariable(context: BodyContext, node: Expression): VariableEntity | undefined {
  const { root } = placePath(node);
  return root.kind === 'Identifier' ? variableAt(context, root) : undefined;
}

function variableAt(context: BodyContext, name: Identifier): VariableEntity | undefined {
  const entity = context.entityOf(name);
  return entity?.kind === 'variable' ? entity : undefined;
}

/** A place's root variable, whether dereferenced (`*x`), its field/tuple steps, and how it reads. */
interface PlaceIdentity {
  readonly variable: VariableEntity;
  readonly dereferenced: boolean;
  readonly steps: readonly string[];
  readonly text: string;
}

/**
 * The identity of a place on a variable (`p.first.0`) or behind the handle a variable holds
 * (`x->a` or `*x`); undefined when it reaches through an indexed element, whose key is known only
 * when running (§3.15), or starts at anything else.
 */
function placeIdentity(context: BodyContext, target: Expression): PlaceIdentity | undefined {
  const { root, steps } = placePath(target);
  const names: string[] = [];
  for (const step of steps) {
    const name = stepName(context, step);
    if (name === undefined) {
      return undefined;
    }
    names.push(name);
  }
  if (root.kind === 'Identifier') {
    const variable = variableAt(context, root);
    return variable === undefined
      ? undefined
      : { variable, dereferenced: false, steps: names, text: [root.text, ...names].join('.') };
  }
  if (root.kind !== 'Dereference' || root.operand.kind !== 'Identifier') {
    return undefined;
  }
  const variable = variableAt(context, root.operand);
  if (variable === undefined) {
    return undefined;
  }
  const handle = root.operand.text;
  const text = names.length === 0 ? `*${handle}` : `${handle}->${names.join('.')}`;
  return { variable, dereferenced: true, steps: names, text };
}

/**
 * The name of the field or element `step` reads, as a place's identity spells it; undefined for an
 * element, or a field a key not known yet names, known only when the program runs.
 */
function stepName(context: BodyContext, step: PlaceStep): string | undefined {
  switch (step.kind) {
    case 'MemberAccess':
      return step.member.text;
    case 'TupleElement':
      return String(step.element);
    default: {
      const key = context.typeOf(step.index);
      const isNamed =
        context.fieldReads.of(step) !== undefined &&
        key.kind === 'literal' &&
        typeof key.value === 'string';
      return isNamed ? String(key.value) : undefined;
    }
  }
}

/** Whether one of two places is the other or a part of it. */
function placesOverlap(first: PlaceIdentity, second: PlaceIdentity): boolean {
  if (first.variable !== second.variable || first.dereferenced !== second.dereferenced) {
    return false;
  }
  const shorter = first.steps.length <= second.steps.length ? first : second;
  const longer = shorter === first ? second : first;
  return shorter.steps.every((step, index) => longer.steps[index] === step);
}

/** Reports a place written twice, or written whole and in part, by one assignment (§3.15). */
export function checkDistinctPlaces(context: BodyContext, parts: readonly AssignedPart[]): void {
  const written: PlaceIdentity[] = [];
  for (const { target } of parts) {
    const place = placeIdentity(context, target);
    const earlier =
      place === undefined ? undefined : written.find((other) => placesOverlap(other, place));
    if (place !== undefined && earlier !== undefined) {
      context.report(checkerDiagnostics.assignedTwice(target.span, place.text, earlier.text));
    }
    if (place !== undefined) {
      written.push(place);
    }
  }
}

/**
 * The accessors of the place `node`, the parts it reaches through a pair of reads and writes,
 * outermost first: the value behind its handle, then each indexed element. A field a key reads is
 * none.
 */
function accessorsOf(context: BodyContext, node: Expression): readonly (Dereference | Index)[] {
  const { root, steps } = placePath(node);
  const elements = steps.filter(
    (step): step is Index => step.kind === 'Index' && context.fieldReads.of(step) === undefined,
  );
  return root.kind === 'Dereference' ? [root, ...elements] : elements;
}

/** Makes the `setIndex` writing back each element the place `node` reaches; false after a report. */
function writesAccessors(context: BodyContext, node: Expression): boolean {
  return accessorsOf(context, node).every(
    (accessor) => accessor.kind !== 'Index' || writesElement(context, accessor),
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

/**
 * Checks a method's receiver passed as `&self` (§3.7), already known to be a place (`isPlace` on
 * the call's callee, expressions/calls.ts), against the rules of changing places.
 */
export function changeReceiver(context: BodyContext, receiver: Expression): void {
  changePlace(context, receiver, 'referenced');
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
  if (!context.variables.isChangeable(entity)) {
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
