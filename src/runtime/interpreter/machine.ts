/**
 * What an instruction handler sees of the running execution, as an interface, so the instruction
 * table depends on it and not on the class that runs the loop (execution.ts), and the frame's
 * registers, which a handler reads and writes directly.
 *
 * A frame is data, as a snapshot stores it (docs/arch/definition.md, "Frames"): a function, a pc
 * and registers. The pc of a frame that has called another stays on its `call` until the callee
 * returns, so a frame's pc always says where it is.
 */

import type { Definition } from '../../definition/definition.ts';
import type { CodeFunction } from '../../definition/functions.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';

export interface ActiveFrame {
  readonly function: FunctionId;
  readonly code: CodeFunction;
  pc: number;
  readonly registers: (Value | undefined)[];
}

export interface Machine {
  readonly definition: Definition;
  /** Calls entry `callee` from `frame`'s current `call`, whose `dst` receives the result. */
  readonly call: (
    frame: ActiveFrame,
    callee: FunctionId,
    argumentList: readonly Argument[],
  ) => void;
  /** Returns `value` from `frame`, the top frame. */
  readonly return: (frame: ActiveFrame, value: Value) => void;
  /**
   * Waits at `frame`'s `await` on the future in register `future`. The frame stays at the `await`
   * until the future resolves; resuming writes the value to its `dst` (scheduler/instance.ts).
   */
  readonly await: (frame: ActiveFrame, future: Register) => void;
}

/** A frame about to run entry `function` from its start, its parameters holding `values`. */
export function newFrame(
  function_: FunctionId,
  code: CodeFunction,
  values: readonly Value[],
): ActiveFrame {
  const registers: (Value | undefined)[] = Array.from({ length: code.registers });
  values.forEach((value, index) => {
    registers[index] = value;
  });
  return { function: function_, code, pc: 0, registers };
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
  const value = frame.registers[register];
  if (value === undefined) {
    throw new Error(`Register ${register} is empty at pc ${frame.pc} of ${frame.code.name}.`);
  }
  return value;
}

export function writeRegister(frame: ActiveFrame, register: Register, value: Value): void {
  frame.registers[register] = value;
}
