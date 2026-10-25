/**
 * The interpreter's table of instruction handlers, one per kind (architecture: Registries). A
 * handler runs one instruction of the top frame and moves its pc: to the next instruction, to a
 * jump's target, or, for a call, nowhere until the callee returns (machine.ts).
 *
 * Instructions of features the runtime doesn't run yet share one handler that refuses them; each
 * feature slice replaces its kinds' entries. Loading has already checked every index and every
 * call's arity, so handlers trust what they read.
 */

import { mapOf, valuesEqual } from '../../definition/equality.ts';
import type { Callee } from '../../definition/instructions/calls.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { FunctionId } from '../../definition/operands.ts';
import { childValues, elementsOf, isComposite, type Value } from '../../definition/values.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import {
  type ActiveFrame,
  capturedContents,
  currentClosure,
  type Machine,
  readRegister,
  storeAt,
  writeRegister,
} from './machine.ts';
import { enterCase, resolvedCase } from './suspension.ts';

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
    next(frame, instruction.dst, constantAt(machine, instruction.constant));
  },
  move: (_machine, instruction, frame) => {
    next(frame, instruction.dst, readRegister(frame, instruction.src));
  },
  tuple: (_machine, instruction, frame) => {
    next(frame, instruction.dst, {
      kind: 'tuple',
      elements: instruction.elements.map((register) => readRegister(frame, register)),
    });
  },
  store: (_machine, instruction, frame) => {
    storeAt(frame, instruction.place, readRegister(frame, instruction.value));
    frame.pc += 1;
  },
  struct: (_machine, instruction, frame) => {
    next(frame, instruction.dst, {
      kind: 'struct',
      type: instruction.type,
      fields: instruction.fields.map((register) => readRegister(frame, register)),
    });
  },
  variant: (_machine, instruction, frame) => {
    next(frame, instruction.dst, {
      kind: 'variant',
      type: instruction.type,
      variant: instruction.variant,
      fields: instruction.fields.map((register) => readRegister(frame, register)),
    });
  },
  field: (_machine, instruction, frame) => {
    const composite = readRegister(frame, instruction.src);
    const value = isComposite(composite) ? childValues(composite)[instruction.index] : undefined;
    if (value === undefined) {
      throw new Error(`No field ${instruction.index} at pc ${frame.pc}.`);
    }
    next(frame, instruction.dst, value);
  },
  equal: (_machine, instruction, frame) => {
    const left = readRegister(frame, instruction.left);
    const right = readRegister(frame, instruction.right);
    next(frame, instruction.dst, valuesEqual(left, right));
  },
  not: (_machine, instruction, frame) => {
    next(frame, instruction.dst, readRegister(frame, instruction.src) !== true);
  },
  order: (_machine, instruction, frame) => {
    const comparison = readRegister(frame, instruction.comparison);
    if (typeof comparison !== 'bigint') {
      throw new TypeError(`'compare' returned a non-int at pc ${frame.pc}.`);
    }
    next(frame, instruction.dst, relations[instruction.relation](comparison));
  },
  jump: (_machine, instruction, frame) => {
    frame.pc = instruction.target;
  },
  branch: (_machine, instruction, frame) => {
    const condition = readRegister(frame, instruction.condition);
    frame.pc = condition === true ? instruction.whenTrue : instruction.whenFalse;
  },
  switch: (_machine, instruction, frame) => {
    const value = readRegister(frame, instruction.value);
    const target = isVariant(value) ? instruction.targets[value.variant] : undefined;
    if (target === undefined) {
      throw new TypeError(`'switch' at pc ${frame.pc} found no variant it has a target for.`);
    }
    frame.pc = target;
  },
  return: (machine, instruction, frame) => {
    machine.return(frame, readRegister(frame, instruction.value));
  },
  await: (machine, _instruction, frame) => {
    machine.wait(frame);
  },
  call: (machine, instruction, frame) => {
    const { function: callee, captures } = calledFunction(frame, instruction.callee);
    machine.call(frame, callee, instruction.arguments, captures);
  },
  array: (_machine, instruction, frame) => {
    next(frame, instruction.dst, {
      kind: 'array',
      elements: instruction.elements.flatMap((element) => {
        const value = readRegister(frame, element.value);
        return element.kind === 'item' ? [value] : elementsOf(value);
      }),
    });
  },
  map: (_machine, instruction, frame) => {
    const entries = instruction.entries.flatMap((entry): (readonly [Value, Value])[] => {
      if (entry.kind === 'entry') {
        return [[readRegister(frame, entry.key), readRegister(frame, entry.value)]];
      }
      return elementsOf(readRegister(frame, entry.value)).map(pairOf);
    });
    next(frame, instruction.dst, mapOf(entries));
  },
  closure: (_machine, instruction, frame) => {
    next(frame, instruction.dst, {
      kind: 'closure',
      function: instruction.function,
      captures: instruction.captures.map((register) => capturedContents(frame, register)),
    });
  },
  currentClosure: (_machine, instruction, frame) => {
    next(frame, instruction.dst, currentClosure(frame));
  },
  spawn: (machine, instruction, frame) => {
    const { function: entry, captures } = calledFunction(frame, instruction.callee);
    machine.spawn({
      function: entry,
      captures: [...captures],
      arguments: instruction.arguments.map((register) => readRegister(frame, register)),
    });
    frame.pc += 1;
  },
  currentCall: notRunYet,
  select: (machine, instruction, frame) => {
    if (instruction.otherwise === undefined) {
      machine.wait(frame);
      return;
    }
    enterCase(frame, instruction, resolvedCase(frame, instruction, machine.settled));
  },
  release: (_machine, instruction, frame) => {
    for (const register of instruction.registers) {
      frame.registers[register] = undefined;
    }
    frame.pc += 1;
  },
  keep: notRunYet,
  defer: notRunYet,
};

/** The function a `call` or `spawn` runs, with the captures of a closure called as a value. */
function calledFunction(
  frame: ActiveFrame,
  callee: Callee,
): { readonly function: FunctionId; readonly captures: readonly Value[] } {
  if (callee.kind === 'function') {
    return { function: callee.function, captures: [] };
  }
  const closure = readRegister(frame, callee.register);
  if (!isComposite(closure) || closure.kind !== 'closure') {
    throw new TypeError(`A non-function was called at pc ${frame.pc}; the checker forbids it.`);
  }
  return { function: closure.function, captures: closure.captures };
}

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

/** The key and value of a `(key, value)` tuple, a map spread's item. */
function pairOf(item: Value): readonly [Value, Value] {
  if (!isComposite(item) || item.kind !== 'tuple' || item.elements.length !== 2) {
    throw new TypeError('A map spread spreads (key, value) tuples.');
  }
  return [item.elements[0] as Value, item.elements[1] as Value];
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
