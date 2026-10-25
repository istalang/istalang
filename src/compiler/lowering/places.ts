/**
 * Places and parts of values (§3.7, §3.9; docs/arch/definition.md, "Places"): what an assignment
 * writes, what `&` passes, and how a destructured part is read.
 *
 * - A Definition place is a variable's register plus field positions into its value, where tuple
 *   elements are fields by position as `field` reads them. Writing one with a path is a `store`,
 *   which builds the new value along it (values are immutable); writing a bare register is a
 *   `move`. A register holding a cell or a reference is read and written through it by the
 *   runtime, so lowering emits the same instructions whatever the variable's storage is.
 * - An indexed element and a `x$` value are reached through calls instead: copied in, read with
 *   the container's `index` (or the `x$`'s `unwrap`) into a register of their own, then changed
 *   there, and written back with `setIndex(&container, key, element)` (or `rewrap(handle, value)`)
 *   once the change is made. That makes an element passed by `&` copy-in/copy-out around its call.
 *   Each key is computed once, before any element is read, so reading and writing back see the
 *   same element. An assignment's last element isn't read first, since a map may not hold its key
 *   yet: it is written with `setIndex` directly.
 * - A register an element is copied into is a cell when something passes it on by `&`: a deeper
 *   element's `setIndex`, or the call the whole place is passed to.
 */

import type { Place } from '../../definition/instructions/places.ts';
import type { Register, TypeId } from '../../definition/operands.ts';
import type { Span } from '../../text/span.ts';
import type { Type } from '../checker/types/type.ts';
import {
  type Expression,
  type Index,
  type MemberAccess,
  type PlaceStep,
  placePath,
  type Unwrap,
} from '../syntax/expressions.ts';
import type { Identifier } from '../syntax/node.ts';
import type { CodeContext, FunctionContext } from './context.ts';
import { emitCall } from './emit-call.ts';

/** What a changed place is once its elements are copied in: a Definition place, or an element. */
export type PlaceTarget =
  | { readonly kind: 'place'; readonly place: Place }
  | {
      readonly kind: 'element';
      readonly container: Place;
      readonly key: Register;
      readonly step: Index;
    };

/** A place entered for a change: its target, and the write-backs that `leave` emits after it. */
export interface EnteredPlace<Target extends PlaceTarget = PlaceTarget> {
  readonly target: Target;
  readonly leave: () => void;
}

/**
 * Enters the place `node` names for an assignment: every element but a last one is copied in, and
 * a `x$` root too, so the target is a Definition place or, for `a[k] = v`, the element itself.
 */
export function enterAssigned(context: FunctionContext, node: Expression): EnteredPlace {
  return enter(context, node, 'assigned');
}

/** Enters the place `node` names to pass it by `&`: every element is copied in, into a cell. */
export function enterReferenced(
  context: FunctionContext,
  node: Expression,
): EnteredPlace<Extract<PlaceTarget, { kind: 'place' }>> {
  const { target, leave } = enter(context, node, 'referenced');
  if (target.kind !== 'place') {
    throw new Error('A referenced place ended at an element it did not copy in.');
  }
  return { target, leave };
}

/** The value at `target`. */
export function readTarget(context: FunctionContext, target: PlaceTarget, span: Span): Register {
  if (target.kind === 'place') {
    return readPlace(context, target.place, span);
  }
  return readElement(context, target, span);
}

/** Writes `value` to `target`. */
export function writeTarget(
  context: FunctionContext,
  target: PlaceTarget,
  value: Register,
  span: Span,
): void {
  if (target.kind === 'element') {
    writeElement(context, target, value);
  } else if (target.place.path.length === 0) {
    context.code.emit({ kind: 'move', span, dst: target.place.register, src: value });
  } else {
    context.code.emit({ kind: 'store', span, place: target.place, value });
  }
}

/** The register the variable `node` names lives in. */
export function variableRegister(context: FunctionContext, node: Identifier): Register {
  const entity = context.entityOf(node);
  if (entity?.kind !== 'variable') {
    throw new Error(`'${node.text}' is not a variable; the checker should have said so.`);
  }
  return context.variables.registerOf(entity.name);
}

/** A fresh register listed as a cell holding a `type`, created as its `Shared<T>` entry. */
export function cellRegister(context: FunctionContext, type: Type): Register {
  const register = context.code.allocate();
  context.variables.addCell({ register, type: cellTypeIndex(context, type) });
  return register;
}

/** Reads the part of the value in `register` at `path`, field and element positions; its register. */
export function readPart(
  context: CodeContext,
  register: Register,
  path: readonly number[],
  span: Span,
): Register {
  return readPlace(context, { register, path: [...path] }, span);
}

/** The position, in its struct's declaration order, of the field `node` reads. */
export function fieldIndexOf(
  context: FunctionContext,
  node: MemberAccess,
  link: Expression = node,
): number {
  const type = context.body.chainOf(link)?.base ?? context.body.typeOf(node.target);
  const index = (context.checker.fieldsOf(type) ?? []).findIndex(
    (field) => field.name === node.member.text,
  );
  if (index < 0) {
    throw new Error(`No field '${node.member.text}'; the checker should have said so.`);
  }
  return index;
}

type PlaceUse = 'assigned' | 'referenced';

/** Computes the place's keys, copies in its root and elements, and returns its target. */
function enter(context: FunctionContext, node: Expression, use: PlaceUse): EnteredPlace {
  const { root, steps } = placePath(node);
  const lowered = steps.map((step) =>
    step.kind === 'Index'
      ? { step, key: context.expression(step.index) }
      : fieldPosition(context, step),
  );
  const lastIndex = steps.findLastIndex((step) => step.kind === 'Index');
  const writeBacks: (() => void)[] = [];
  const leave = () => {
    for (const writeBack of writeBacks.toReversed()) {
      writeBack();
    }
  };
  /** Whether the register copied in before step `position` is passed on by `&`. */
  const passedOn = (position: number) => use === 'referenced' || position <= lastIndex;
  let current = rootPlace(context, root, passedOn(0), writeBacks);
  for (const [position, step] of lowered.entries()) {
    if (typeof step === 'number') {
      current = { ...current, path: [...current.path, step] };
    } else {
      const element = { kind: 'element', container: current, ...step } as const;
      if (use === 'assigned' && position === lowered.length - 1) {
        return { target: element, leave };
      }
      current = copyIn(context, element, passedOn(position + 1), writeBacks);
    }
  }
  return { target: { kind: 'place', place: current }, leave };
}

/** The Definition place a place's root starts: its variable, or the value a `x$` reads. */
function rootPlace(
  context: FunctionContext,
  root: Expression,
  passedOn: boolean,
  writeBacks: (() => void)[],
): Place {
  if (root.kind === 'Identifier') {
    return { register: variableRegister(context, root), path: [] };
  }
  if (root.kind !== 'Unwrap') {
    throw new Error(`A ${root.kind} is no place; the checker should have said so.`);
  }
  return copyInUnwrapped(context, root, passedOn, writeBacks);
}

/** Copies in the value `x$` reads, to be written back with the `rewrap` the checker made. */
function copyInUnwrapped(
  context: FunctionContext,
  node: Unwrap,
  passedOn: boolean,
  writeBacks: (() => void)[],
): Place {
  const handle = context.expression(node.operand);
  const value = copyRegister(context, node, passedOn);
  emitCall(
    context,
    { span: node.span, callee: context.calleeIndex(node), arguments: [handle] },
    value,
  );
  writeBacks.push(() => {
    const callee = context.implicitCallee(node, 'write');
    emitCall(context, { span: node.span, callee, arguments: [handle, value] });
  });
  return { register: value, path: [] };
}

/** Copies in `element`, to be written back with its `setIndex` once the change is made. */
function copyIn(
  context: FunctionContext,
  element: Extract<PlaceTarget, { kind: 'element' }>,
  passedOn: boolean,
  writeBacks: (() => void)[],
): Place {
  const value = copyRegister(context, element.step, passedOn);
  readElement(context, element, element.step.span, value);
  writeBacks.push(() => {
    writeElement(context, element, value);
  });
  return { register: value, path: [] };
}

/** A register to copy `node`'s value into: a cell when it is passed on by `&`. */
function copyRegister(context: FunctionContext, node: Expression, passedOn: boolean): Register {
  return passedOn ? cellRegister(context, context.body.typeOf(node)) : context.code.allocate();
}

/** Reads `element` with its container's `index`; the register of its value. */
function readElement(
  context: FunctionContext,
  element: Extract<PlaceTarget, { kind: 'element' }>,
  span: Span,
  dst?: Register,
): Register {
  const container = readPlace(context, element.container, span);
  const callee = context.calleeIndex(element.step);
  return emitCall(context, { span, callee, arguments: [container, element.key] }, dst);
}

/** Writes `value` to `element` with its container's `setIndex(&container, key, value)`. */
function writeElement(
  context: FunctionContext,
  element: Extract<PlaceTarget, { kind: 'element' }>,
  value: Register,
): void {
  const { container, key, step } = element;
  emitCall(context, {
    span: step.span,
    callee: context.implicitCallee(step, 'write'),
    arguments: [{ kind: 'reference', place: container }, key, value],
  });
}

/** Reads the value at `place`: its register's value, read along the place's field positions. */
function readPlace(context: CodeContext, place: Place, span: Span): Register {
  let current = place.register;
  for (const index of place.path) {
    const dst = context.code.allocate();
    context.code.emit({ kind: 'field', span, dst, src: current, index });
    current = dst;
  }
  return current;
}

/** The field position a field or tuple element step reads. */
function fieldPosition(context: FunctionContext, step: Exclude<PlaceStep, Index>): number {
  return step.kind === 'MemberAccess' ? fieldIndexOf(context, step) : step.element;
}

/** The `Shared<T>` entry a cell holding a `type` is created as. */
function cellTypeIndex(context: FunctionContext, type: Type): TypeId {
  return context.tables.typeIndex(context.checker.sharedOf(type));
}
