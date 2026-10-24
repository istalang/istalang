/**
 * One execution: a stack of frames as data, run instruction by instruction (docs/arch/
 * definition.md, "Frames"). The interpreted program's call stack never lives on JavaScript's, so
 * deep recursion in a workflow can't overflow it, and every frame is ready to be persisted.
 *
 * Every call goes through the function table (function-table.ts): a native runs at once and its
 * result lands in the call's `dst`; a code entry pushes a frame, and its `return` writes the
 * result into the caller's `call` and moves the caller on.
 */

import type { Definition } from '../../definition/definition.ts';
import type { Argument } from '../../definition/instructions/places.ts';
import type { FunctionId } from '../../definition/operands.ts';
import type { Value } from '../../definition/values.ts';
import type { FunctionTable } from './function-table.ts';
import { runInstruction } from './instructions.ts';
import { type ActiveFrame, type Machine, readRegister, writeRegister } from './machine.ts';
import { traceOf } from './trace.ts';

export class Execution implements Machine {
  readonly definition: Definition;
  readonly #functions: FunctionTable;
  readonly #frames: ActiveFrame[] = [];
  #result: { readonly value: Value } | undefined;

  constructor(definition: Definition, functions: FunctionTable) {
    this.definition = definition;
    this.#functions = functions;
  }

  /** Runs entry `entry` with `argumentValues` until it returns; its result. */
  run(entry: FunctionId, argumentValues: readonly Value[]): Value {
    this.#enter(entry, argumentValues);
    while (this.#result === undefined) {
      const frame = this.#top();
      const instruction = frame.code.instructions[frame.pc];
      if (instruction === undefined) {
        throw new RangeError(`pc ${frame.pc} is past the end; loading checks termination.`);
      }
      runInstruction(this, frame, instruction);
    }
    return this.#result.value;
  }

  /** Where each frame is, innermost first, for a panic's trace (§3.12). */
  trace(): string {
    return traceOf(this.definition, this.#frames.toReversed());
  }

  call(frame: ActiveFrame, callee: FunctionId, argumentList: readonly Argument[]): void {
    const values = argumentList.map((argument) => {
      if (argument.kind !== 'value') {
        throw new Error("The runtime doesn't pass references yet.");
      }
      return readRegister(frame, argument.register);
    });
    const callable = this.#functions.callee(callee);
    if (callable.kind === 'native') {
      resumeAfterCall(frame, callable.native(values));
      return;
    }
    if (callable.code.async) {
      throw new Error("The runtime doesn't call async functions yet.");
    }
    this.#enter(callable.function, values);
  }

  return(frame: ActiveFrame, value: Value): void {
    if (this.#frames.pop() !== frame) {
      throw new Error('Only the top frame returns.');
    }
    const caller = this.#frames.at(-1);
    if (caller === undefined) {
      this.#result = { value };
    } else {
      resumeAfterCall(caller, value);
    }
  }

  #enter(entry: FunctionId, argumentValues: readonly Value[]): void {
    const callable = this.#functions.callee(entry);
    if (callable.kind !== 'code') {
      throw new Error(`Entry ${entry} is not code.`);
    }
    const registers: (Value | undefined)[] = Array.from({ length: callable.code.registers });
    argumentValues.forEach((value, index) => {
      registers[index] = value;
    });
    this.#frames.push({ function: callable.function, code: callable.code, pc: 0, registers });
  }

  #top(): ActiveFrame {
    const frame = this.#frames.at(-1);
    if (frame === undefined) {
      throw new Error('No frame is running.');
    }
    return frame;
  }
}

/** Writes a call's result into the `call` that `frame` stopped at, and moves past it. */
function resumeAfterCall(frame: ActiveFrame, value: Value): void {
  const instruction = frame.code.instructions[frame.pc];
  if (instruction?.kind !== 'call') {
    throw new Error(`Resumed at a ${instruction?.kind ?? 'missing'} instruction, not a call.`);
  }
  if (instruction.dst !== undefined) {
    writeRegister(frame, instruction.dst, value);
  }
  frame.pc += 1;
}
