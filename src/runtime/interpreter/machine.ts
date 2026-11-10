/**
 * What an instruction handler sees of the running execution, as an interface, so the instruction
 * table depends on it and not on the class that runs the loop (scheduler/segment/); and a frame's
 * life (frames.ts): made at its entry with its parameters, moved past what it stood at, and
 * letting go of what it held as it ends. A handler reads and writes the frame's registers directly
 * (registers.ts).
 */

import type { Definition } from '../../definition/definition.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { isReference, type RegisterContents } from '../snapshot/objects.ts';
import type { ActiveFrame, FrameEntry, FrameHeap } from './frames.ts';
import { capturedContents, clearRegister, writeRegister } from './registers.ts';

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
  const { code, arrives } = entry;
  const registers: (RegisterContents | undefined)[] = Array.from({ length: code.registers });
  const frame: ActiveFrame = {
    function: entry.function,
    code,
    pc: 0,
    registers,
    heap,
    ...(arrives ? { arrives } : {}),
  };
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

/** Lets go of everything `frame`'s registers hold, as it ends. */
export function releaseFrame(frame: ActiveFrame): void {
  for (const register of frame.registers.keys()) {
    clearRegister(frame, register);
  }
}
