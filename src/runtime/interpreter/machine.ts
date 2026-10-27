/**
 * What an instruction handler sees of the running execution, as an interface, so the instruction
 * table depends on it and not on the class that runs the loop (scheduler/segment/), and the
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
 * A live frame carries the instance's heap for that; it isn't part of what a snapshot stores.
 * A path holds field positions only (values/parts.ts), so reading or writing a register never runs
 * code.
 *
 * Whatever a register lets go of, overwritten or emptied, and whatever a frame held when it ends,
 * is reported to the heap (`released`): it may have been the last holder of something disposable,
 * which the scheduler then collects (runtime/lifetimes/). Registers change only through the
 * functions here, so no write can skip the report.
 */

import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/functions.ts';
import type { Argument, Place } from '../../definition/instructions/places.ts';
import type { FunctionId, Register, TypeId } from '../../definition/operands.ts';
import { handleTarget, type Value } from '../../definition/values.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { isReference, type Reference, type RegisterContents } from '../snapshot/objects.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';
import { partAt, withPart } from '../values/parts.ts';

/** The instance's heap as frames reach it: the cells their registers name, and what they let go. */
export interface FrameHeap {
  readonly read: (cell: number) => Value;
  readonly write: (cell: number, value: Value) => void;
  /** A new cell of type entry `type` (a shared struct's or a `_Cell<T>`) holding `value`; its id. */
  readonly create: (type: TypeId, value: Value) => number;
  /**
   * Notes that a frame no longer holds `contents`, which may have held something's last handle. A
   * reference never does: it borrows a cell its caller holds for the whole call.
   */
  readonly released: (contents: RegisterContents) => void;
}

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
  /** What `keep` moved here: holdings that last until the function returns (spec §3.4). */
  readonly kept: Value[];
  readonly heap: FrameHeap;
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
   * Waits at `frame`'s `await` or blocking `select` on the futures its registers name. The frame
   * stays there until one resolves; resuming moves it on (suspension.ts).
   */
  readonly wait: (frame: ActiveFrame) => void;
  /** The value of the future `handle` names, once it has resolved. */
  readonly settled: (handle: Value) => { readonly value: Value } | undefined;
  /** Starts `call` as a new instance once the running segment commits (§9). */
  readonly spawn: (call: InstanceCall) => void;
  /** A handle to a new guard that calls the function value `callback` when disposed (§7). */
  readonly guard: (callback: Value) => Value;
  /** A handle to the weak reference to the running async call, for `worker.disposing()` (§7). */
  readonly currentCall: () => Value;
}

/**
 * A frame about to run entry `function` from its start, its parameters holding `contents`: values,
 * and references for reference parameters. A closure's captures follow the parameters as the
 * closure carries them: a captured cell stays the closure's cell, shared with where it came from.
 */
export function newFrame(
  entry: FrameEntry,
  contents: readonly RegisterContents[],
  heap: FrameHeap,
  captures: readonly Value[] = [],
): ActiveFrame {
  const { code } = entry;
  const registers: (RegisterContents | undefined)[] = Array.from({ length: code.registers });
  const frame: ActiveFrame = { function: entry.function, code, pc: 0, registers, kept: [], heap };
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

/** Writes a call's result into the `call` that `frame` stopped at, and moves past it. */
export function resumeAfterCall(frame: ActiveFrame, value: Value): void {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'call') {
    unreachable(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a call.`);
  }
  resumeAt(frame, instruction.dst, value);
}

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
    frame.registers[register] = { kind: 'handle', object: frame.heap.create(cell.type, value) };
  } else {
    frame.heap.write(cellOf(contents), value);
  }
}

/** A handle to a new cell of type entry `type` holding `value`: a shared struct's (§3.18). */
export function newCell(frame: ActiveFrame, type: TypeId, value: Value): Value {
  return { kind: 'handle', object: frame.heap.create(type, value) };
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

/** Lets go of everything `frame` holds, in its registers and kept list, as it ends. */
export function releaseFrame(frame: ActiveFrame): void {
  for (const register of frame.registers.keys()) {
    clearRegister(frame, register);
  }
  for (const contents of frame.kept.splice(0)) {
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

/** The value at the place a reference names. */
function readThrough(heap: FrameHeap, reference: Reference): Value {
  return partAt(heap.read(reference.cell), reference.path);
}

/** What `contents`, a call's arguments, pass: each value, read through any reference. */
export function passedValues(heap: FrameHeap, contents: readonly RegisterContents[]): Value[] {
  return contents.map((each) => (isReference(each) ? readThrough(heap, each) : each));
}

/** Writes `value` to the place a reference names. */
export function writeReference(heap: FrameHeap, reference: Reference, value: Value): void {
  heap.write(reference.cell, withPart(heap.read(reference.cell), reference.path, value));
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
