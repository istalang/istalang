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
