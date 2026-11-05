/**
 * Places and parts of values (§3.7, §3.9; docs/arch/definition.md, "Places"): what an assignment
 * writes, what `&` passes, and how a destructured part is read.
 *
 * - A Definition place is a variable's register plus field positions into its value, where tuple
 *   elements are fields by position as `field` reads them. Writing one with a path is a `store`,
 *   which builds the new value along it (values are immutable); writing a bare register is a
 *   `move`. A register holding a cell or a reference is read and written through it by the
 *   runtime, so lowering emits the same instructions whatever the variable's storage is.
 * - A field reached by a key of one name (`s["x"]`, §3.9) is a field position as `s.x` is; one
 *   reached by a key of several names is the field the key's value names, a switch on it
 *   (keyed-fields.ts), each case reaching its field and the field positions past it. Nothing
 *   passes it by `&`, nor reaches an accessor past it, which takes its container by `&`.
 * - A value written where a key of several names reads the place converts into whichever field
 *   the key names (`WrittenFit`), derived from the concrete field types: in each case of the
 *   switch, or, where the instantiation left the key one name, into that one field.
 * - An indexed element and the value behind a handle (`*x`) are reached through an accessor
 *   instead, a pair of reads and writes: an element is read with its container's `index` and
 *   written with `setIndex(&container, key, element)`, the value behind a handle with `readCell`
 *   and `writeCell`. A place is located once, when entered: its handle and keys are computed then,
 *   in source order, so reading and writing see the same parts.
 * - A part behind an accessor is read and written as the accessor's value stands at that moment:
 *   writing it reads that value, stores the part into it and writes it back, at each accessor from
 *   the innermost out. So whatever changed another part between a compound assignment's read and
 *   its write, or during the call a part is passed to by `&`, stays changed. An assignment ending
 *   at an element doesn't read it, since a map may not hold its key yet: it is written with
 *   `setIndex` directly.
 * - A part behind an accessor passed by `&` is copied into a cell of its own, written back when
 *   the call returns (copy-in/copy-out); so is an accessor's value whose element `setIndex` takes
 *   by `&`.
 */

import type { Place } from '../../definition/instructions/places.ts';
import type { Register, TypeId } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { WrittenFit } from '../checker/check.ts';
import type { FieldMember, Type } from '../checker/types/type.ts';
import { chainStepOf } from '../syntax/expressions/chains.ts';
import type { Dereference, Expression, Index, MemberAccess } from '../syntax/expressions/index.ts';
import { type PlaceStep, placePath } from '../syntax/expressions/places.ts';
import type { Identifier } from '../syntax/node.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { CodeContext, FunctionContext } from './context.ts';
import { emitFunctionCall } from './emit-call.ts';
import type { TypedValue } from './holdings.ts';
import {
  eachKeyedField,
  fittedInto,
  type KeyedField,
  readKeyed,
  writeKeyed,
} from './keyed-fields.ts';

/**
 * A part of a place reached through a read and a write (§3.7, §3.9). An element is read with its
 * container's `index` and written with `setIndex(&container, key, element)`; the value behind a
 * handle is read with `readCell` and written with `writeCell`.
 */
interface Accessor {
  readonly node: Index | Dereference;
  /** Reads the part, into `dst` when given; its register. */
  readonly read: (span: AnchoredSpan, dst?: Register) => Register;
  readonly write: (value: Register) => void;
}

/**
 * Where a place is: a Definition place, field positions into the value an accessor reads, or field
 * positions `path` past the field of a place `within` a key's value names, the place's value then
 * being of `type`.
 */
type Location =
  | { readonly kind: 'place'; readonly place: Place }
  | { readonly kind: 'accessor'; readonly accessor: Accessor; readonly path: readonly number[] }
  | {
      readonly kind: 'keyed';
      readonly within: Location;
      readonly keyed: KeyedField;
      readonly path: readonly number[];
      readonly type: Type;
    };

/** A place entered for an assignment, read and written where it stands when each happens. */
export interface AssignedPlace {
  readonly read: (span: AnchoredSpan) => Register;
  /** Writes `value`, converted into the place as `fit` says. */
  readonly write: (value: TypedValue, fit: WrittenFit, span: AnchoredSpan) => void;
}

/** Enters the place `node` names for an assignment, computing its handle and keys. */
export function enterAssigned(context: FunctionContext, node: Expression): AssignedPlace {
  const location = locate(context, node);
  return {
    read: (span) => readAt(context, location, span),
    write: (value, fit, span) => {
      if (fit !== 'intoKeyedField') {
        writeAt(context, location, context.fitted(value.register, value.type, fit, node), span);
      } else if (location.kind === 'keyed') {
        const { within, keyed, path } = location;
        writeKeyed(context, { keyed, value, site: node }, (field, position, converted) =>
          writeAt(context, pastField(within, position, path, field.type), converted, span),
        );
      } else {
        const converted = fittedInto(context, value, context.typeOf(node), node);
        writeAt(context, location, converted, span);
      }
    },
  };
}

/** A place passed by `&`, and what writes its copy back once the call returns. */
export interface ReferencedPlace {
  readonly place: Place;
  readonly leave: (() => void) | undefined;
}

/**
 * Enters the place `node` names to pass it by `&`: a Definition place as it is, a part behind an
 * accessor copied into a cell and written back by `leave`.
 */
export function enterReferenced(context: FunctionContext, node: Expression): ReferencedPlace {
  const location = locate(context, node);
  if (location.kind === 'place') {
    return { place: location.place, leave: undefined };
  }
  if (location.kind === 'keyed') {
    return unreachable(`A key of several fields at ${node.span.from} is passed by '&'.`);
  }
  const cell = cellRegister(context, context.typeOf(node));
  const src = readAt(context, location, node.span);
  context.code.emit({ kind: 'move', span: node.span, dst: cell, src });
  return {
    place: { register: cell, path: [] },
    leave: () => writeAt(context, location, cell, node.span),
  };
}

/** The register the variable `node` names lives in. */
function variableRegister(context: FunctionContext, node: Identifier): Register {
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

/** The position, in its struct's declaration order, of the field `node` reads. */
function fieldPositionOf(context: FunctionContext, node: MemberAccess): number {
  const read = context.fieldReadOf(node);
  if (read.kind !== 'position') {
    unreachable(`The field read at ${node.span.from} has no position: it reads no struct.`);
  }
  return read.index;
}

/** Locates the place `node` names: its root, then each step, computing handle and keys in order. */
function locate(context: FunctionContext, node: Expression): Location {
  const { root, steps } = placePath(node);
  let location: Location =
    root.kind === 'Identifier'
      ? { kind: 'place', place: { register: variableRegister(context, root), path: [] } }
      : { kind: 'accessor', accessor: sharedAccessor(context, root), path: [] };
  for (const step of steps) {
    location = stepped(context, location, step);
  }
  return location;
}

/** `location`, then `step`: a field's or an element's, computing a key there. */
function stepped(context: FunctionContext, location: Location, step: PlaceStep): Location {
  const type = context.typeOf(step);
  if (step.kind !== 'Index') {
    return withFields(location, [fieldPosition(context, step)], type);
  }
  const key = context.expression(step.index);
  const read = context.body.fieldReadOf(step);
  if (read === undefined) {
    return { kind: 'accessor', accessor: elementAccessor(context, location, key, step), path: [] };
  }
  if (read.kind === 'position') {
    return withFields(location, [read.index], type);
  }
  if (read.kind !== 'keyed') {
    return unreachable(`A key reads no ${read.kind} field once instantiated.`);
  }
  const keyed = { on: read.on, key: { register: key, type: context.typeOf(step.index) } };
  return { kind: 'keyed', within: location, keyed, path: [], type };
}

/** `location` field `positions` deeper, its value then being of `type`. */
function withFields(location: Location, positions: readonly number[], type: Type): Location {
  switch (location.kind) {
    case 'place': {
      const path = [...location.place.path, ...positions];
      return { ...location, place: { ...location.place, path } };
    }
    case 'accessor':
      return { ...location, path: [...location.path, ...positions] };
    case 'keyed':
      return { ...location, path: [...location.path, ...positions], type };
    default: {
      const unhandled: never = location;
      return unhandled;
    }
  }
}

/**
 * The place at `path` past the field at `position` of the place `within`: what one case of a key's
 * switch reaches, its value of `type`.
 */
function pastField(
  within: Location,
  position: number,
  path: readonly number[],
  type: Type,
): Location {
  return withFields(within, [position, ...path], type);
}

/** Reads the value at `location` as it stands now. */
function readAt(context: FunctionContext, location: Location, span: AnchoredSpan): Register {
  if (location.kind === 'place') {
    return readPlace(context, location.place, span);
  }
  if (location.kind === 'keyed') {
    const { within, keyed, path, type } = location;
    const readField = (field: FieldMember, position: number) => {
      const reached = path.length === 0 ? field.type : type;
      const register = readAt(context, pastField(within, position, path, reached), span);
      return { register, type: reached };
    };
    return readKeyed(context, { keyed, result: type }, readField, span);
  }
  const { accessor, path } = location;
  return readPlace(context, { register: accessor.read(span), path: [...path] }, span);
}

/** Writes `value` at `location`: a part behind an accessor into its value as it stands now. */
function writeAt(
  context: FunctionContext,
  location: Location,
  value: Register,
  span: AnchoredSpan,
): void {
  if (location.kind === 'accessor' && location.path.length === 0) {
    location.accessor.write(value);
    return;
  }
  changeAt(context, location, { passedOn: false, span }, (place) => {
    if (place.path.length === 0) {
      context.code.emit({ kind: 'move', span, dst: place.register, src: value });
    } else {
      context.code.emit({ kind: 'store', span, place, value });
    }
  });
}

/** How a change reaches its place: whether it passes the place on by `&`, and where it is written. */
interface Changing {
  readonly passedOn: boolean;
  readonly span: AnchoredSpan;
}

/**
 * Runs `change` on `location` as a Definition place: an accessor's value is read into a register,
 * a cell when `change` passes it on by `&`, changed, then written back; a field a key's value
 * names is changed in each case of a switch on it.
 */
function changeAt(
  context: FunctionContext,
  location: Location,
  changing: Changing,
  change: (place: Place) => void,
): void {
  if (location.kind === 'place') {
    change(location.place);
    return;
  }
  if (location.kind === 'keyed') {
    const { within, keyed, path, type } = location;
    eachKeyedField(context, keyed, changing.span, (field, position) => {
      const reached = path.length === 0 ? field.type : type;
      changeAt(context, pastField(within, position, path, reached), changing, change);
    });
    return;
  }
  const { accessor, path } = location;
  const register = changing.passedOn
    ? cellRegister(context, context.typeOf(accessor.node))
    : context.code.allocate();
  accessor.read(accessor.node.span, register);
  change({ register, path: [...path] });
  accessor.write(register);
}

/** The element of `container` at `key`, read and written with the calls the checker made at `node`. */
function elementAccessor(
  context: FunctionContext,
  container: Location,
  key: Register,
  node: Index,
): Accessor {
  return {
    node,
    read: (span, dst) => {
      const value = readAt(context, container, span);
      const call = context.callAt(node);
      return emitFunctionCall(context, { span, call, arguments: [value, key] }, dst);
    },
    write: (value) => {
      changeAt(context, container, { passedOn: true, span: node.span }, (place) => {
        emitFunctionCall(context, {
          span: node.span,
          call: context.implicitCallAt(node, 'write'),
          arguments: [{ kind: 'reference', place }, key, value],
        });
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
    chainStepOf(node) === undefined
      ? context.expression(node.operand)
      : context.chains.target(context, node);
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
function readPlace(context: CodeContext, place: Place, span: AnchoredSpan): Register {
  return context.code.readPath(place.register, place.path, span);
}

/** The field position a field or tuple element step reads. */
function fieldPosition(context: FunctionContext, step: Exclude<PlaceStep, Index>): number {
  return step.kind === 'MemberAccess' ? fieldPositionOf(context, step) : step.element;
}

/** The `_Cell<T>` entry a cell holding a `type` is created as. */
function cellTypeIndex(context: FunctionContext, type: Type): TypeId {
  return context.tables.types.index(context.checker.cellOf(type));
}
