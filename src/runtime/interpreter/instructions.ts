/**
 * The interpreter's table of instruction handlers, one per kind (architecture: Registries). A
 * handler runs one instruction of the top frame and moves its pc: to the next instruction, to a
 * jump's target, or, for a call, nowhere until the callee returns (machine.ts).
 *
 * Instructions of features the runtime doesn't run yet share one handler that refuses them; each
 * feature slice replaces its kinds' entries. Loading has already checked every index and every
 * call's arity, so handlers trust what they read.
 */

import type { Instruction, InstructionKind } from '../../definition/instructions/instruction.ts';
import { childValues, isComposite, type Value } from '../../definition/values.ts';
import { valuesEqual } from '../values/equality.ts';
import { type ActiveFrame, type Machine, readRegister, writeRegister } from './machine.ts';

type InstructionHandlers = {
  readonly [Kind in InstructionKind]: (
    machine: Machine,
    frame: ActiveFrame,
    instruction: Extract<Instruction, { kind: Kind }>,
  ) => void;
};

const notRunYet = (_machine: Machine, _frame: ActiveFrame, instruction: Instruction): void => {
  throw new Error(`The runtime doesn't run '${instruction.kind}' instructions yet.`);
};

const relations = {
  less: (comparison: bigint) => comparison < 0n,
  lessOrEqual: (comparison: bigint) => comparison <= 0n,
  greater: (comparison: bigint) => comparison > 0n,
  greaterOrEqual: (comparison: bigint) => comparison >= 0n,
};

const handlers: InstructionHandlers = {
  constant: (machine, frame, instruction) => {
    next(frame, instruction.dst, constantAt(machine, instruction.constant));
  },
  move: (_machine, frame, instruction) => {
    next(frame, instruction.dst, readRegister(frame, instruction.src));
  },
  struct: (_machine, frame, instruction) => {
    next(frame, instruction.dst, {
      kind: 'struct',
      type: instruction.type,
      fields: instruction.fields.map((register) => readRegister(frame, register)),
    });
  },
  field: (_machine, frame, instruction) => {
    const composite = readRegister(frame, instruction.src);
    const value = isComposite(composite) ? childValues(composite)[instruction.index] : undefined;
    if (value === undefined) {
      throw new Error(`No field ${instruction.index} at pc ${frame.pc}.`);
    }
    next(frame, instruction.dst, value);
  },
  equal: (_machine, frame, instruction) => {
    const left = readRegister(frame, instruction.left);
    const right = readRegister(frame, instruction.right);
    next(frame, instruction.dst, valuesEqual(left, right));
  },
  not: (_machine, frame, instruction) => {
    next(frame, instruction.dst, readRegister(frame, instruction.src) !== true);
  },
  order: (_machine, frame, instruction) => {
    const comparison = readRegister(frame, instruction.comparison);
    if (typeof comparison !== 'bigint') {
      throw new TypeError(`'compare' returned a non-int at pc ${frame.pc}.`);
    }
    next(frame, instruction.dst, relations[instruction.relation](comparison));
  },
  jump: (_machine, frame, instruction) => {
    frame.pc = instruction.target;
  },
  branch: (_machine, frame, instruction) => {
    const condition = readRegister(frame, instruction.condition);
    frame.pc = condition === true ? instruction.whenTrue : instruction.whenFalse;
  },
  return: (machine, frame, instruction) => {
    machine.return(frame, readRegister(frame, instruction.value));
  },
  await: (machine, frame, instruction) => {
    machine.await(frame, instruction.future);
  },
  call: (machine, frame, instruction) => {
    if (instruction.callee.kind !== 'function') {
      notRunYet(machine, frame, instruction);
      return;
    }
    machine.call(frame, instruction.callee.function, instruction.arguments);
  },
  tuple: notRunYet,
  variant: notRunYet,
  store: notRunYet,
  array: notRunYet,
  map: notRunYet,
  closure: notRunYet,
  currentClosure: notRunYet,
  switch: notRunYet,
  spawn: notRunYet,
  currentCall: notRunYet,
  select: notRunYet,
  release: notRunYet,
  keep: notRunYet,
  defer: notRunYet,
};

/** Runs `instruction`, the instruction at `frame`'s pc. */
export function runInstruction(
  machine: Machine,
  frame: ActiveFrame,
  instruction: Instruction,
): void {
  (handlers[instruction.kind] as (m: Machine, f: ActiveFrame, i: Instruction) => void)(
    machine,
    frame,
    instruction,
  );
}

/** Writes `value` to `dst` and moves on to the next instruction. */
function next(frame: ActiveFrame, dst: number, value: Value): void {
  writeRegister(frame, dst, value);
  frame.pc += 1;
}

function constantAt(machine: Machine, index: number): Value {
  const value = machine.definition.constants[index];
  if (value === undefined) {
    throw new RangeError(`No constant ${index}; loading checks every index.`);
  }
  return value;
}
