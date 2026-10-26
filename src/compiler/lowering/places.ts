/**
 * Places and parts of values (§3.7, §3.9; docs/arch/definition.md, "Places"): what an assignment
 * writes, what `&` passes, and how a destructured part is read.
 *
 * - A Definition place is a variable's register plus field positions into its value, where tuple
 *   elements are fields by position as `field` reads them. Writing one with a path is a `store`,
 *   which builds the new value along it (values are immutable); writing a bare register is a
 *   `move`. A register holding a cell or a reference is read and written through it by the
 *   runtime, so lowering emits the same instructions whatever the variable's storage is.
 * - An indexed element and the value behind a handle (`*x`) are reached through an accessor
 *   instead, a pair of reads and writes: copied in, read with the container's `index` (or the
 *   handle's `readCell`) into a register of their own, then changed there, and written back with
 *   `setIndex(&container, key, element)` (or `writeCell`) once the change is made. That makes an
 *   element passed by `&` copy-in/copy-out around its call.
 *   Each key is computed once, before any element is read, so reading and writing back see the
 *   same element. An assignment's last element isn't read first, since a map may not hold its key
 *   yet: it is written with `setIndex` directly.
 * - A register an element is copied into is a cell when something passes it on by `&`: a deeper
 *   element's `setIndex`, or the call the whole place is passed to.
 */

import type { Place } from '../../definition/instructions/places.ts';
import type { Register, TypeId } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import type { Type } from '../checker/types/type.ts';
import {
  type Dereference,
  type Expression,
  type Index,
  type MemberAccess,
  type PlaceStep,
  placePath,
} from '../syntax/expressions.ts';
import type { Identifier } from '../syntax/node.ts';
import type { CodeContext, FunctionContext } from './context.ts';
import { emitCall } from './emit-call.ts';

/**
 * What a changed place is once its accessors are copied in: a Definition place, or, for `a[k] = v`
 * or `*x = v`, the last accessor itself, which the assignment writes without reading it.
 */
export type PlaceTarget =
  | { readonly kind: 'place'; readonly place: Place }
  | { readonly kind: 'accessor'; readonly accessor: Accessor };

/**
 * A part of a place reached through a read and a write (§3.7, §3.9). An element is read with its
 * container's `index` and written with `setIndex(&container, key, element)`; the value behind a
 * handle is read with `readCell` and written with `writeCell`.
 */
interface Accessor {
  readonly node: Index | Dereference;
  /** Reads the part, into `dst` when given; its register. */
  readonly read: (span: Span, dst?: Register) => Register;
  readonly write: (value: Register) => void;
}

/** A place entered for a change: its target, and the write-backs that `leave` emits after it. */
export interface EnteredPlace<Target extends PlaceTarget = PlaceTarget> {
  readonly target: Target;
  readonly leave: () => void;
}

/**
 * Enters the place `node` names for an assignment: every accessor but a last one is copied in, so
 * the target is a Definition place or, for `a[k] = v` or `*x = v`, the accessor itself.
 */
export function enterAssigned(context: FunctionContext, node: Expression): EnteredPlace {
  return enter(context, node, 'assigned');
}

/** Enters the place `node` names to pass it by `&`: every accessor is copied in, into a cell. */
export function enterReferenced(
  context: FunctionContext,
  node: Expression,
): EnteredPlace<Extract<PlaceTarget, { kind: 'place' }>> {
  const { target, leave } = enter(context, node, 'referenced');
  if (target.kind !== 'place') {
    unreachable('A referenced place ended at an accessor it did not copy in.');
  }
  return { target, leave };
}

/** The value at `target`. */
export function readTarget(context: FunctionContext, target: PlaceTarget, span: Span): Register {
  if (target.kind === 'place') {
    return readPlace(context, target.place, span);
  }
  return target.accessor.read(span);
}

/** Writes `value` to `target`. */
export function writeTarget(
  context: FunctionContext,
  target: PlaceTarget,
  value: Register,
  span: Span,
): void {
  if (target.kind === 'accessor') {
    target.accessor.write(value);
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
    unreachable(`'${node.text}' is not a variable; the checker should have said so.`);
  }
  return context.variables.registerOf(entity.name);
}

/** A fresh register listed as a cell holding a `type`, created as its `_Cell<T>` entry. */
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
    unreachable(`No field '${node.member.text}'; the checker should have said so.`);
  }
  return index;
}

type PlaceUse = 'assigned' | 'referenced';

/** Computes the place's keys, copies in its root and accessors, and returns its target. */
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
  if (root.kind !== 'Identifier' && use === 'assigned' && lowered.length === 0) {
    return { target: { kind: 'accessor', accessor: sharedAccessor(context, root) }, leave };
  }
  let current =
    root.kind === 'Identifier'
      ? { register: variableRegister(context, root), path: [] }
      : copyIn(context, sharedAccessor(context, root), passedOn(0), writeBacks);
  for (const [position, step] of lowered.entries()) {
    if (typeof step === 'number') {
      current = { ...current, path: [...current.path, step] };
    } else {
      const accessor = elementAccessor(context, current, step.key, step.step);
      if (use === 'assigned' && position === lowered.length - 1) {
        return { target: { kind: 'accessor', accessor }, leave };
      }
      current = copyIn(context, accessor, passedOn(position + 1), writeBacks);
    }
  }
  return { target: { kind: 'place', place: current }, leave };
}

/** Copies in what `accessor` reads, to be written back once the change is made. */
function copyIn(
  context: FunctionContext,
  accessor: Accessor,
  passedOn: boolean,
  writeBacks: (() => void)[],
): Place {
  const value = copyRegister(context, accessor.node, passedOn);
  accessor.read(accessor.node.span, value);
  writeBacks.push(() => {
    accessor.write(value);
  });
  return { register: value, path: [] };
}

/** A register to copy `node`'s value into: a cell when it is passed on by `&`. */
function copyRegister(context: FunctionContext, node: Expression, passedOn: boolean): Register {
  return passedOn ? cellRegister(context, context.body.typeOf(node)) : context.code.allocate();
}

/** The element of `container` at `key`, read and written with the calls the checker made at `node`. */
function elementAccessor(
  context: FunctionContext,
  container: Place,
  key: Register,
  node: Index,
): Accessor {
  return {
    node,
    read: (span, dst) => {
      const value = readPlace(context, container, span);
      const callee = context.calleeIndex(node);
      return emitCall(context, { span, callee, arguments: [value, key] }, dst);
    },
    write: (value) => {
      emitCall(context, {
        span: node.span,
        callee: context.implicitCallee(node, 'write'),
        arguments: [{ kind: 'reference', place: container }, key, value],
      });
    },
  };
}

/** `*x` read as a value: the value behind the shared struct `x`, read from its cell (§3.9). */
export function lowerDereference(context: FunctionContext, node: Dereference): Register {
  return sharedAccessor(context, node).read(node.span);
}

/**
 * The value behind the shared struct a place's root `node` reads, computing it (§3.9); `x->` reads
 * its handle as a link of an optional chain (optional-chains.ts).
 */
function sharedAccessor(context: FunctionContext, node: Expression): Accessor {
  if (node.kind !== 'Dereference') {
    unreachable(`A ${node.kind} is no place; the checker should have said so.`);
  }
  const cell =
    node.operator === '*' ? context.expression(node.operand) : context.chains.target(context, node);
  return {
    node,
    read: (span, dst = context.code.allocate()) => {
      context.code.emit({ kind: 'readCell', span, dst, cell });
      return dst;
    },
    write: (value) => {
      context.code.emit({ kind: 'writeCell', span: node.span, cell, value });
    },
  };
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

/** The `_Cell<T>` entry a cell holding a `type` is created as. */
function cellTypeIndex(context: FunctionContext, type: Type): TypeId {
  return context.tables.typeIndex(context.checker.cellOf(type));
}
