/**
 * The interpreter's table of instruction handlers, one per kind (architecture: Registries). A
 * handler runs one instruction of the top frame and moves its pc: to the next instruction, to a
 * jump's target, or, for a call, nowhere until the callee returns (machine.ts).
 *
 * Loading has already checked every index and every call's arity, so handlers trust what they
 * read.
 */

import { mapOf, valuesEqual } from '../../definition/equality.ts';
import { instanceHandle } from '../../definition/instance-handles.ts';
import type { Callee } from '../../definition/instructions/calls.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { FunctionId } from '../../definition/operands.ts';
import {
  childValues,
  closureOf,
  elementsOf,
  isComposite,
  mapValueOf,
  type Value,
} from '../../definition/values.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { unreachable } from '../../structures/unreachable.ts';
import { isReference } from '../snapshot/objects.ts';
import {
  type ActiveFrame,
  capturedContents,
  clearRegister,
  currentClosure,
  type Machine,
  newCell,
  readCell,
  readRegister,
  storeAt,
  writeCell,
  writeRegister,
} from './machine.ts';
import { enterCase, resolvedCase } from './suspension.ts';

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
  newCell: (_machine, instruction, frame) => {
    next(
      frame,
      instruction.dst,
      newCell(frame, instruction.type, readRegister(frame, instruction.value)),
    );
  },
  readCell: (_machine, instruction, frame) => {
    next(frame, instruction.dst, readCell(frame, instruction.cell));
  },
  writeCell: (_machine, instruction, frame) => {
    writeCell(frame, instruction.cell, readRegister(frame, instruction.value));
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
      unreachable(`No field ${instruction.index} at pc ${frame.pc}.`);
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
      unreachable(`'compare' returned a non-int at pc ${frame.pc}.`);
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
    const target = isVariant(value)
      ? (instruction.targets[value.variant] ?? instruction.otherwise)
      : undefined;
    if (target === undefined) {
      unreachable(`'switch' at pc ${frame.pc} found no variant it has a target for.`);
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
      return [...mapValueOf(readRegister(frame, entry.value)).entries];
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
    const name = machine.spawn({
      function: entry,
      captures: [...captures],
      arguments: instruction.arguments.map((register) => readRegister(frame, register)),
    });
    next(frame, instruction.dst, instanceHandle(instruction.type, name));
  },
  currentCall: (machine, instruction, frame) => {
    next(frame, instruction.dst, machine.currentCall());
  },
  select: (machine, instruction, frame) => {
    if (instruction.otherwise === undefined) {
      machine.wait(frame);
      return;
    }
    enterCase(frame, instruction, resolvedCase(frame, instruction, machine.settled));
  },
  release: (_machine, instruction, frame) => {
    for (const register of instruction.registers) {
      clearRegister(frame, register);
    }
    frame.pc += 1;
  },
  keep: (_machine, instruction, frame) => {
    const kept = instruction.registers.flatMap((register) => {
      const contents = frame.registers[register];
      return contents === undefined || isReference(contents) ? [] : [contents];
    });
    const { into } = instruction;
    const earlier =
      frame.registers[into] === undefined ? [] : elementsOf(readRegister(frame, into));
    // A new array rather than a push: a committed snapshot may share the old one.
    writeRegister(frame, into, { kind: 'array', elements: [...earlier, ...kept] });
    frame.pc += 1;
  },
  defer: (machine, instruction, frame) => {
    next(frame, instruction.dst, machine.guard(readRegister(frame, instruction.callback)));
  },
};

/** The function a `call` or `spawn` runs, with the captures of a closure called as a value. */
function calledFunction(
  frame: ActiveFrame,
  callee: Callee,
): { readonly function: FunctionId; readonly captures: readonly Value[] } {
  if (callee.kind === 'function') {
    return { function: callee.function, captures: [] };
  }
  const closure =
    closureOf(readRegister(frame, callee.register)) ??
    unreachable(`A non-function was called at pc ${frame.pc}; the checker forbids it.`);
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

/** Writes `value` to `dst` and moves on to the next instruction. */
function next(frame: ActiveFrame, dst: number, value: Value): void {
  writeRegister(frame, dst, value);
  frame.pc += 1;
}

function constantAt(machine: Machine, index: number): Value {
  const value = machine.definition.constants[index];
  if (value === undefined) {
    unreachable(`No constant ${index}; loading checks every index.`);
  }
  return value;
}
