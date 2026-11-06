/**
 * Assignments (§3.4, §3.9, §3.15).
 *
 * - A target is a place, or a tuple or struct literal of targets that takes the value apart, by the
 *   walk a declaration's targets take (constructs/patterns/walk.ts); several targets are a tuple of
 *   them. Taking a value apart checks the value on its own first, then fits each part to the place
 *   it goes to.
 * - In a struct target, the shorthand `first` assigns the variable `first`, and a struct with one
 *   field takes a positional target, as a literal takes a positional value (§3.1).
 * - Only a `let` is reassigned. A parameter is the function's own copy (§3.1), so it may be too;
 *   a `const`, and a binding a pattern or loop introduces, never is. Changing part of a variable is
 *   the rule of places (resolution/calls/places.ts).
 * - A compound assignment `x += y` is `x = x + y` (§3.9): the operator's function is resolved for
 *   the place's type and recorded on the assignment, and its result must fit the place.
 * - A value written to an optional place is wrapped into it (§2), whether the whole value, a part
 *   of it or an operator's result, so each part records its own fit. A place a key that may name
 *   several fields reads takes a value fitting each of them (§3.9), which converts into whichever
 *   the key names once its fields are concrete: its part records that, not one conversion
 *   (`WrittenFit`), since an instantiation may leave the key one name or several.
 * - `*x = v` writes the value behind the handle `x` whole (§3.9;
 *   constructs/expressions/access/dereference.ts), as its one part.
 * - `_` as a target holds the value without a name, so it records no part to write (§3.4).
 * - Taking a value apart writes each place once: no target is another's place, or a part of it,
 *   so the order the parts are written in never decides a value (§3.15).
 * - What lowering needs is recorded: each place written, with its part of the value and its fit.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import { type CompoundAssignment, compoundOperator } from '../../../syntax/operators.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import type { Assignment } from '../../../syntax/statements/index.ts';
import {
  type Destructuring,
  destructuringOf,
  isUnnamedTarget,
} from '../../../syntax/statements/targets.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { binaryApplied, resolveOperator } from '../../resolution/calls/operators.ts';
import {
  checkChangedPlace,
  checkDistinctPlaces,
  immutableKind,
  severalKeyedFields,
} from '../../resolution/calls/places.ts';
import { stoppedOperation } from '../../resolution/calls/stopped-operations.ts';
import type { AssignedPart, WrittenFit } from '../../surface/checked-body.ts';
import type { FieldStep } from '../../surface/checked-pattern.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, tupleType } from '../../types/type/primitives.ts';
import { anyShape, type Shape } from '../patterns/exhaustiveness/exhaustiveness.ts';
import { bodyScope, type ValuePart } from '../patterns/parts.ts';
import { type Taking, takeApart, takeTargets } from '../patterns/taking.ts';

export function checkAssignment(context: BodyContext, node: Assignment): void {
  const [only, ...more] = node.targets;
  if (only === undefined) {
    return;
  }
  if (more.length === 0 && node.operator !== '=') {
    checkCompound(context, node, only, node.operator);
    return;
  }
  const targets = node.targets.map((target) => prepareTarget(context, target));
  const [first] = targets;
  const expected =
    targets.length === 1 && first !== undefined ? expectedOf(first) : tupleExpected(targets);
  const whole = { type: context.expression(node.value, expected), path: [] };
  const assigning = assigningIn(context, node.value.span);
  takeTargets(assigning, targets, whole, node.span);
  checkDistinctPlaces(context, assigning.parts);
  context.variables.recordAssigned(node, assigning.parts);
}

/**
 * A target with its place checked: a place of its type, `_`, or a destructuring of such targets.
 * The targets are prepared in source order before the value is checked, which they may guide, and
 * taking the value apart then walks them, not the syntax again.
 */
type PreparedTarget =
  | { readonly kind: 'place'; readonly node: Expression; readonly type: Type }
  | { readonly kind: 'unnamed' }
  | { readonly kind: 'destructuring'; readonly destructuring: Destructuring<PreparedTarget> };

function prepareTarget(context: BodyContext, target: Expression): PreparedTarget {
  const destructuring = destructuringOf(target);
  if (destructuring?.kind === 'tuple') {
    const elements = destructuring.elements.map((element) => prepareTarget(context, element));
    return { kind: 'destructuring', destructuring: { ...destructuring, elements } };
  }
  if (destructuring?.kind === 'struct') {
    const items = destructuring.items.map((item) => ({
      ...item,
      target: prepareTarget(context, item.target),
    }));
    return { kind: 'destructuring', destructuring: { ...destructuring, items } };
  }
  const bare = unparenthesized(target);
  return isUnnamedTarget(bare)
    ? { kind: 'unnamed' }
    : { kind: 'place', node: bare, type: assignedPlace(context, bare) };
}

/**
 * The type `target` expects of the value it takes, which guides checking it; undefined when any
 * part gives none, as `_` or a struct target.
 */
function expectedOf(target: PreparedTarget): Type | undefined {
  switch (target.kind) {
    case 'place':
      return target.type.kind === 'error' ? undefined : target.type;
    case 'unnamed':
      return undefined;
    case 'destructuring':
      return target.destructuring.kind === 'tuple'
        ? tupleExpected(target.destructuring.elements)
        : undefined;
    default: {
      const unhandled: never = target;
      return unhandled;
    }
  }
}

function tupleExpected(elements: readonly PreparedTarget[]): Type | undefined {
  const types = elements.map(expectedOf);
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
  const operands = [
    { node: target, type: place },
    { node: node.value, type: context.expression(node.value) },
  ];
  const result =
    stoppedOperation(context, node, operands) ??
    resolveOperator(context, node, binaryApplied(compoundOperator(operator)), operands);
  const fit = writtenFit(context, target, { type: result, place, at: node.value.span });
  context.variables.recordAssigned(node, [{ target, path: [], type: result, fit }]);
}

/**
 * A value of `type` written to `place`, the type of `target`, as an assignment reports it at `at`.
 */
interface Written {
  readonly type: Type;
  readonly place: Type;
  readonly at: AnchoredSpan;
}

/**
 * How a value written to `target` fits it: as its place's type says, or, where a key that may name
 * several fields reads it, fitting each of their types, then converted into whichever the key names
 * as the instantiation makes it concrete.
 */
function writtenFit(
  context: BodyContext,
  target: Expression,
  { type, place, at }: Written,
): WrittenFit {
  const fields = severalKeyedFields(context, target);
  if (fields === undefined) {
    return context.fitWritten(type, place, at);
  }
  for (const field of fields) {
    context.fitWritten(type, field, at);
  }
  return 'intoKeyedField';
}

/**
 * Taking an assigned value apart (constructs/patterns/taking.ts): where the places written are
 * collected. Its parts are tuple positions and struct fields, since an assignment's targets read no
 * array's items.
 */
/** A step an assignment's part is reached by: a tuple position or a struct's field. */
type AssignedStep = number | FieldStep;

interface Assigning extends Taking<PreparedTarget, AssignedStep> {
  readonly parts: AssignedPart[];
  readonly valueSpan: AnchoredSpan;
}

function assigningIn(context: BodyContext, valueSpan: AnchoredSpan): Assigning {
  const assigning: Assigning = {
    scope: bodyScope(context),
    parts: [],
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
  target: PreparedTarget,
  part: ValuePart<AssignedStep>,
): Shape | undefined {
  switch (target.kind) {
    case 'destructuring':
      return takeApart(assigning, target.destructuring, part);
    case 'unnamed':
      return anyShape;
    case 'place': {
      const at = part.path.length === 0 ? assigning.valueSpan : target.node.span;
      const fit = writtenFit(context, target.node, { type: part.type, place: target.type, at });
      assigning.parts.push({ target: target.node, path: part.path, type: part.type, fit });
      return anyShape;
    }
    default: {
      const unhandled: never = target;
      return unhandled;
    }
  }
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
  if (!context.variables.isChangeable(entity)) {
    context.report(
      checkerDiagnostics.constReassigned(target.span, target.text, immutableKind(entity.owner)),
    );
    return errorType;
  }
  context.variables.noteChanged(entity);
  return context.variables.typeOf(entity);
}
