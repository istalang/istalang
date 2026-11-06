/**
 * A frame's registers (frames.ts), read and written. Registers mean what the function says they
 * are, so reading and writing one is the same call whatever it holds:
 * - a register the function lists in `cells` holds a handle to a cell in the instance's heap, a
 *   variable that is passed by `&`; the cell is made by the first write, and holds the value;
 * - a reference parameter's register holds a reference: a cell and a path into its value (§3.7);
 * - a closure's capture of a `let` holds the cell the closure carries, a cell register too (§3.14);
 * - any other register holds its value.
 * A path holds field positions only (interpreter/parts.ts), so reading or writing a register never
 * runs code.
 *
 * Whatever a register lets go of, overwritten or emptied, and whatever a frame held when it ends,
 * is reported to the heap (`released`): it may have been the last holder of something disposable,
 * which the scheduler then collects (runtime/lifetimes/). Registers change only through the
 * functions here, so no write can skip the report.
 */

import type { Argument, Place } from '../../definition/instructions/places.ts';
import type { Register, TypeId } from '../../definition/operands.ts';
import { handleTarget, handleTo, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { isReference, type Reference, type RegisterContents } from '../snapshot/objects.ts';
import type { ActiveFrame, FrameHeap } from './frames.ts';
import { partAt, withPart } from './parts.ts';

/** The value in `register` of `frame`; loading checks indexes, so an empty one is a bug. */
export function readRegister(frame: ActiveFrame, register: Register): Value {
  const contents = frame.registers[register];
  if (contents === undefined) {
    unreachable(`Register ${register} is empty at pc ${frame.pc} of ${frame.code.name}.`);
  }
  if (isReference(contents)) {
    return readThrough(frame.heap, contents);
  }
  return isCell(frame, register) ? frame.heap.read(cellOf(contents)) : contents;
}

export function writeRegister(frame: ActiveFrame, register: Register, value: Value): void {
  const contents = frame.registers[register];
  if (contents !== undefined && isReference(contents)) {
    writeReference(frame.heap, contents, value);
    return;
  }
  const cell = frame.code.cells.find((each) => each.register === register);
  if (cell === undefined) {
    frame.registers[register] = value;
    if (contents !== undefined) {
      frame.heap.released(contents);
    }
  } else if (contents === undefined) {
    frame.registers[register] = handleTo(frame.heap.create(cell.type, value));
  } else {
    frame.heap.write(cellOf(contents), value);
  }
}

/** A handle to a new cell of type entry `type` holding `value`: a shared struct's (§3.18). */
export function newCell(frame: ActiveFrame, type: TypeId, value: Value): Value {
  return handleTo(frame.heap.create(type, value));
}

/** The value in the cell the handle in `register` names (§3.9). */
export function readCell(frame: ActiveFrame, register: Register): Value {
  return frame.heap.read(cellOf(readRegister(frame, register)));
}

/** Writes `value` to the cell the handle in `register` names, for every copy of the handle. */
export function writeCell(frame: ActiveFrame, register: Register, value: Value): void {
  frame.heap.write(cellOf(readRegister(frame, register)), value);
}

/** Empties `register`, letting go of what it held: a cell register, its cell. */
export function clearRegister(frame: ActiveFrame, register: Register): void {
  const contents = frame.registers[register];
  frame.registers[register] = undefined;
  if (contents !== undefined) {
    frame.heap.released(contents);
  }
}

/** Writes `value` to `place`, building the new value of its variable along the path. */
export function storeAt(frame: ActiveFrame, place: Place, value: Value): void {
  const contents = frame.registers[place.register];
  if (contents !== undefined && isReference(contents)) {
    writeReference(frame.heap, { ...contents, path: [...contents.path, ...place.path] }, value);
    return;
  }
  const whole = readRegister(frame, place.register);
  writeRegister(frame, place.register, withPart(whole, place.path, value));
}

/** What a call passes for `argument`: the value, or for `&`, a reference to the caller's place. */
export function argumentContents(frame: ActiveFrame, argument: Argument): RegisterContents {
  if (argument.kind === 'value') {
    return readRegister(frame, argument.register);
  }
  const { register, path } = argument.place;
  const contents = frame.registers[register];
  if (contents !== undefined && isReference(contents)) {
    return { kind: 'reference', cell: contents.cell, path: [...contents.path, ...path] };
  }
  if (contents === undefined || !isCell(frame, register)) {
    unreachable(`Register ${register} is passed by '&' but isn't a cell.`);
  }
  return { kind: 'reference', cell: cellOf(contents), path };
}

/** What `contents`, a call's arguments, pass: each value, read through any reference. */
export function passedValues(heap: FrameHeap, contents: readonly RegisterContents[]): Value[] {
  return contents.map((each) => (isReference(each) ? readThrough(heap, each) : each));
}

/** Writes `value` to the place a reference names. */
export function writeReference(heap: FrameHeap, reference: Reference, value: Value): void {
  heap.write(reference.cell, withPart(heap.read(reference.cell), reference.path, value));
}

/**
 * What a closure made from `register` carries: the cell itself for a cell register, so the
 * closure shares it (§3.14), and the value for any other.
 */
export function capturedContents(frame: ActiveFrame, register: Register): Value {
  const contents = frame.registers[register];
  if (contents !== undefined && !isReference(contents) && isCell(frame, register)) {
    return contents;
  }
  return readRegister(frame, register);
}

/** The value at the place a reference names. */
function readThrough(heap: FrameHeap, reference: Reference): Value {
  return partAt(heap.read(reference.cell), reference.path);
}

function isCell(frame: ActiveFrame, register: Register): boolean {
  return frame.code.cells.some((cell) => cell.register === register);
}

function cellOf(contents: RegisterContents): number {
  const cell = isReference(contents) ? undefined : handleTarget(contents);
  if (cell === undefined) {
    unreachable('A cell register or a dereferenced handle holds no cell.');
  }
  return cell;
}
