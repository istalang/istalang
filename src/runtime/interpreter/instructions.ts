/**
 * The interpreter's table of instruction handlers, one per kind (architecture: Registries). A
 * handler runs one instruction of the top frame and moves its pc: to the next instruction, to a
 * jump's target, or, for a call, nowhere until the callee returns (machine.ts).
 *
 * Instructions of features the runtime doesn't run yet share one handler that refuses them; each
 * feature slice replaces its kinds' entries. Loading has already checked every index and every
 * call's arity, so handlers trust what they read.
 */

import type { Instruction } from '../../definition/instructions/instruction.ts';
import { childValues, isComposite, type Value } from '../../definition/values.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { valuesEqual } from '../values/equality.ts';
import { mapOf } from '../values/maps.ts';
import { type ActiveFrame, type Machine, readRegister, storeAt, writeRegister } from './machine.ts';

const notRunYet = (_machine: Machine, instruction: Instruction): void => {
  throw new Error(`The runtime doesn't run '${instruction.kind}' instructions yet.`);
};

const relations = {
  less: (comparison: bigint) => comparison < 0n,
  lessOrEqual: (comparison: bigint) => comparison <= 0n,
  greater: (comparison: bigint) => comparison > 0n,
  greaterOrEqual: (comparison: bigint) => comparison >= 0n,
};

const handlers: Handlers<Machine, Instruction, [ActiveFrame], void> = {
  constant: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, constantAt(machine, instruction.constant));
  },
  move: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, readRegister(frame, instruction.src, machine));
  },
  tuple: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, {
      kind: 'tuple',
      elements: instruction.elements.map((register) => readRegister(frame, register, machine)),
    });
  },
  store: (machine, instruction, frame) => {
    storeAt(frame, instruction.place, readRegister(frame, instruction.value, machine), machine);
    frame.pc += 1;
  },
  struct: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, {
      kind: 'struct',
      type: instruction.type,
      fields: instruction.fields.map((register) => readRegister(frame, register, machine)),
    });
  },
  variant: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, {
      kind: 'variant',
      type: instruction.type,
      variant: instruction.variant,
      fields: instruction.fields.map((register) => readRegister(frame, register, machine)),
    });
  },
  field: (machine, instruction, frame) => {
    const composite = readRegister(frame, instruction.src, machine);
    const value = isComposite(composite) ? childValues(composite)[instruction.index] : undefined;
    if (value === undefined) {
      throw new Error(`No field ${instruction.index} at pc ${frame.pc}.`);
    }
    next(machine, frame, instruction.dst, value);
  },
  equal: (machine, instruction, frame) => {
    const left = readRegister(frame, instruction.left, machine);
    const right = readRegister(frame, instruction.right, machine);
    next(machine, frame, instruction.dst, valuesEqual(left, right));
  },
  not: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, readRegister(frame, instruction.src, machine) !== true);
  },
  order: (machine, instruction, frame) => {
    const comparison = readRegister(frame, instruction.comparison, machine);
    if (typeof comparison !== 'bigint') {
      throw new TypeError(`'compare' returned a non-int at pc ${frame.pc}.`);
    }
    next(machine, frame, instruction.dst, relations[instruction.relation](comparison));
  },
  jump: (_machine, instruction, frame) => {
    frame.pc = instruction.target;
  },
  branch: (machine, instruction, frame) => {
    const condition = readRegister(frame, instruction.condition, machine);
    frame.pc = condition === true ? instruction.whenTrue : instruction.whenFalse;
  },
  switch: (machine, instruction, frame) => {
    const value = readRegister(frame, instruction.value, machine);
    const target = isVariant(value) ? instruction.targets[value.variant] : undefined;
    if (target === undefined) {
      throw new TypeError(`'switch' at pc ${frame.pc} found no variant it has a target for.`);
    }
    frame.pc = target;
  },
  return: (machine, instruction, frame) => {
    machine.return(frame, readRegister(frame, instruction.value, machine));
  },
  await: (machine, instruction, frame) => {
    machine.await(frame, instruction.future);
  },
  call: (machine, instruction, frame) => {
    if (instruction.callee.kind !== 'function') {
      notRunYet(machine, instruction);
      return;
    }
    machine.call(frame, instruction.callee.function, instruction.arguments);
  },
  array: (machine, instruction, frame) => {
    next(machine, frame, instruction.dst, {
      kind: 'array',
      elements: instruction.elements.flatMap((element) => {
        const value = readRegister(frame, element.value, machine);
        return element.kind === 'item' ? [value] : elementsOf(value);
      }),
    });
  },
  map: (machine, instruction, frame) => {
    const entries = instruction.entries.flatMap((entry): (readonly [Value, Value])[] => {
      if (entry.kind === 'entry') {
        return [
          [readRegister(frame, entry.key, machine), readRegister(frame, entry.value, machine)],
        ];
      }
      return elementsOf(readRegister(frame, entry.value, machine)).map(pairOf);
    });
    next(machine, frame, instruction.dst, mapOf(entries));
  },
  closure: notRunYet,
  currentClosure: notRunYet,
  spawn: notRunYet,
  currentCall: notRunYet,
  select: notRunYet,
  release: notRunYet,
  keep: notRunYet,
  defer: notRunYet,
};

function isVariant(value: Value): value is Extract<Value, { kind: 'variant' }> {
  return isComposite(value) && value.kind === 'variant';
}

/** Runs `instruction`, the instruction at `frame`'s pc. */
export function runInstruction(
  machine: Machine,
  frame: ActiveFrame,
  instruction: Instruction,
): void {
  handlerOf(handlers, instruction)(machine, instruction, frame);
}

/** The elements of an array, which a spread spreads: `iterate` gives one (docs/arch/definition.md). */
function elementsOf(value: Value): readonly Value[] {
  if (!isComposite(value) || value.kind !== 'array') {
    throw new TypeError('A spread spreads an array; iterate gives one.');
  }
  return value.elements;
}

/** The key and value of a `(key, value)` tuple, a map spread's item. */
function pairOf(item: Value): readonly [Value, Value] {
  if (!isComposite(item) || item.kind !== 'tuple' || item.elements.length !== 2) {
    throw new TypeError('A map spread spreads (key, value) tuples.');
  }
  return [item.elements[0] as Value, item.elements[1] as Value];
}

/** Writes `value` to `dst` and moves on to the next instruction. */
function next(machine: Machine, frame: ActiveFrame, dst: number, value: Value): void {
  writeRegister(frame, dst, value, machine);
  frame.pc += 1;
}

function constantAt(machine: Machine, index: number): Value {
  const value = machine.definition.constants[index];
  if (value === undefined) {
    throw new RangeError(`No constant ${index}; loading checks every index.`);
  }
  return value;
}
