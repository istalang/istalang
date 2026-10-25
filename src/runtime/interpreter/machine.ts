/**
 * What an instruction handler sees of the running execution, as an interface, so the instruction
 * table depends on it and not on the class that runs the loop (scheduler/segment.ts), and the
 * frame's registers, which a handler reads and writes directly.
 *
 * A frame is data, as a snapshot stores it (docs/arch/definition.md, "Frames"): a function, a pc
 * and registers. The pc of a frame that has called another stays on its `call` until the callee
 * returns, so a frame's pc always says where it is.
 *
 * Registers mean what the function says they are, so reading and writing one is the same call
 * whatever it holds:
 * - a register the function lists in `cells` holds a handle to a cell in the instance's heap, a
 *   variable that is passed by `&`; the cell is made by the first write, and holds the value;
 * - a reference parameter's register holds a reference: a cell and a path into its value (§3.7);
 * - a closure's capture of a `let` holds the cell the closure carries, a cell register too (§3.14);
 * - any other register holds its value.
 * A live frame carries the instance's cells for that; they aren't part of what a snapshot stores.
 * A path holds field positions only (values/parts.ts), so reading or writing a register never runs
 * code.
 */

import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/functions.ts';
import type { Argument, Place } from '../../definition/instructions/places.ts';
import type { FunctionId, Register, TypeId } from '../../definition/operands.ts';
import { handleTarget, type Value } from '../../definition/values.ts';
import { isReference, type Reference } from '../snapshot/objects.ts';
import { partAt, withPart } from '../values/parts.ts';

/** The instance's cells as frames reach them. */
export interface CellStore {
  readonly read: (cell: number) => Value;
  readonly write: (cell: number, value: Value) => void;
  /** A new cell of type entry `type` (a `Shared<T>`) holding `value`; its id. */
  readonly create: (type: TypeId, value: Value) => number;
}

/** What a register holds: a value, or for a reference parameter, a reference. */
export type RegisterContents = Value | Reference;

/** A code entry a frame runs: its index, and its code. */
export interface FrameEntry {
  readonly function: FunctionId;
  readonly code: CodeFunction;
}

export interface ActiveFrame {
  readonly function: FunctionId;
  readonly code: CodeFunction;
  pc: number;
  readonly registers: (RegisterContents | undefined)[];
  readonly cells: CellStore;
}

export interface Machine {
  readonly definition: Definition;
  /**
   * Calls entry `callee` from `frame`'s current `call`, whose `dst` receives the result; a
   * closure's call passes the values it captured.
   */
  readonly call: (
    frame: ActiveFrame,
    callee: FunctionId,
    argumentList: readonly Argument[],
    captures?: readonly Value[],
  ) => void;
  /** Returns `value` from `frame`, the top frame. */
  readonly return: (frame: ActiveFrame, value: Value) => void;
  /**
   * Waits at `frame`'s `await` on the future in register `future`. The frame stays at the `await`
   * until the future resolves; resuming writes the value to its `dst` (scheduler/instance.ts).
   */
  readonly await: (frame: ActiveFrame, future: Register) => void;
}

/**
 * A frame about to run entry `function` from its start, its parameters holding `contents`: values,
 * and references for reference parameters. A closure's captures follow the parameters as the
 * closure carries them: a captured cell stays the closure's cell, shared with where it came from.
 */
export function newFrame(
  entry: FrameEntry,
  contents: readonly RegisterContents[],
  cells: CellStore,
  captures: readonly Value[] = [],
): ActiveFrame {
  const { code } = entry;
  const registers: (RegisterContents | undefined)[] = Array.from({ length: code.registers });
  const frame: ActiveFrame = { function: entry.function, code, pc: 0, registers, cells };
  contents.forEach((each, index) => {
    if (isReference(each)) {
      registers[index] = each;
    } else {
      writeRegister(frame, index, each);
    }
  });
  captures.forEach((each, index) => {
    registers[contents.length + index] = each;
  });
  return frame;
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

/** The closure `frame` runs: its function, with its captures as the closure carried them. */
export function currentClosure(frame: ActiveFrame): Value {
  const first = frame.code.parameters.length;
  const captures = Array.from({ length: frame.code.captures }, (_, index) =>
    capturedContents(frame, first + index),
  );
  return { kind: 'closure', function: frame.function, captures };
}

/** Moves `frame` past the instruction it stood at, which gave `value` to `dst`, if it has one. */
export function resumeAt(frame: ActiveFrame, dst: Register | undefined, value: Value): void {
  if (dst !== undefined) {
    writeRegister(frame, dst, value);
  }
  frame.pc += 1;
}

/** The value in `register` of `frame`; loading checks indexes, so an empty one is a bug. */
export function readRegister(frame: ActiveFrame, register: Register): Value {
  const contents = frame.registers[register];
  if (contents === undefined) {
    throw new Error(`Register ${register} is empty at pc ${frame.pc} of ${frame.code.name}.`);
  }
  if (isReference(contents)) {
    return readThrough(frame.cells, contents);
  }
  return isCell(frame, register) ? frame.cells.read(cellOf(contents)) : contents;
}

export function writeRegister(frame: ActiveFrame, register: Register, value: Value): void {
  const contents = frame.registers[register];
  if (contents !== undefined && isReference(contents)) {
    writeReference(frame.cells, contents, value);
    return;
  }
  const cell = frame.code.cells.find((each) => each.register === register);
  if (cell === undefined) {
    frame.registers[register] = value;
  } else if (contents === undefined) {
    frame.registers[register] = { kind: 'handle', object: frame.cells.create(cell.type, value) };
  } else {
    frame.cells.write(cellOf(contents), value);
  }
}

/** Writes `value` to `place`, building the new value of its variable along the path. */
export function storeAt(frame: ActiveFrame, place: Place, value: Value): void {
  const contents = frame.registers[place.register];
  if (contents !== undefined && isReference(contents)) {
    writeReference(frame.cells, { ...contents, path: [...contents.path, ...place.path] }, value);
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
    throw new Error(`Register ${register} is passed by '&' but isn't a cell.`);
  }
  return { kind: 'reference', cell: cellOf(contents), path };
}

/** The value at the place a reference names. */
export function readThrough(cells: CellStore, reference: Reference): Value {
  return partAt(cells.read(reference.cell), reference.path);
}

/** Writes `value` to the place a reference names. */
export function writeReference(cells: CellStore, reference: Reference, value: Value): void {
  cells.write(reference.cell, withPart(cells.read(reference.cell), reference.path, value));
}

function isCell(frame: ActiveFrame, register: Register): boolean {
  return frame.code.cells.some((cell) => cell.register === register);
}

function cellOf(contents: RegisterContents): number {
  const cell = isReference(contents) ? undefined : handleTarget(contents);
  if (cell === undefined) {
    throw new TypeError('A cell register holds no cell.');
  }
  return cell;
}
