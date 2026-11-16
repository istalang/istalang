/**
 * The interpreter's table of instruction handlers, one per kind (architecture: Registries). A
 * handler runs one instruction of the top frame and moves its pc: to the next instruction, to a
 * jump's target, or, for a call, nowhere until the callee returns (frames.ts).
 *
 * Loading has already checked every index and every call's arity, so handlers trust what they
 * read.
 *
 * What an instruction builds is the instance's own, which it may change in place while nothing else
 * holds it (lifetimes/in-place.ts). An array or map built from the one its own register holds, and
 * more (`[...dst, item]`, what a comprehension or a spread through a cursor appends per item), grows
 * that one, as does a hold's list of what it keeps.
 */

import type { Callee } from '../../definition/instructions/calls.ts';
import type { Instruction } from '../../definition/instructions/instruction.ts';
import type { FunctionId, Register } from '../../definition/operands.ts';
import { mapOf, valuesEqual } from '../../definition/values/equality.ts';
import { fieldAt } from '../../definition/values/parts.ts';
import {
  type CompositeValue,
  closureOf,
  elementsOf,
  handleTo,
  isComposite,
  mapValueOf,
  type Value,
} from '../../definition/values/values.ts';
import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { isReference } from '../snapshot/objects.ts';
import type { ActiveFrame } from './frames.ts';
import { currentClosure, type Machine } from './machine.ts';
import {
  capturedContents,
  clearRegister,
  newCell,
  placeContents,
  readCell,
  readRegister,
  referenceBehind,
  storeAt,
  writeRegister,
} from './registers.ts';
import { enterCase, releaseLosers } from './suspension.ts';

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
    built(frame, instruction.dst, {
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
  behind: (_machine, instruction, frame) => {
    placeContents(frame, instruction.dst, referenceBehind(frame, instruction.handle));
    frame.pc += 1;
  },
  contextConstant: (_machine, instruction, frame) => {
    const value = frame.heap.contextConstant(instruction.name);
    if (value === undefined) {
      frame.pc += 1;
    } else {
      writeRegister(frame, instruction.dst, value);
      frame.pc = instruction.target;
    }
  },
  makeContextConstant: (_machine, instruction, frame) => {
    frame.heap.makeContextConstant(instruction.name, readRegister(frame, instruction.value));
    frame.pc += 1;
  },
  transient: (machine, instruction, frame) => {
    const cell = machine.sharedTransient(frame, instruction.dst);
    if (cell === undefined) {
      frame.pc += 1;
    } else {
      placeContents(frame, instruction.dst, handleTo(cell));
      frame.pc = instruction.target;
    }
  },
  struct: (_machine, instruction, frame) => {
    built(frame, instruction.dst, {
      kind: 'struct',
      type: instruction.type,
      fields: instruction.fields.map((register) => readRegister(frame, register)),
    });
  },
  variant: (_machine, instruction, frame) => {
    built(frame, instruction.dst, {
      kind: 'variant',
      type: instruction.type,
      variant: instruction.variant,
      fields: instruction.fields.map((register) => readRegister(frame, register)),
    });
  },
  field: (_machine, instruction, frame) => {
    next(frame, instruction.dst, fieldAt(readRegister(frame, instruction.src), instruction.index));
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
  wait: (machine, instruction, frame) => {
    next(frame, instruction.dst, machine.openWait());
  },
  resolver: (machine, instruction, frame) => {
    const wait = readRegister(frame, instruction.wait);
    next(frame, instruction.dst, machine.resolver(wait, instruction.position));
  },
  await: (machine) => {
    machine.wait();
  },
  call: (machine, instruction, frame) => {
    const { function: callee, captures } = calledFunction(frame, instruction.callee);
    machine.call(frame, callee, instruction.arguments, captures);
  },
  array: (_machine, instruction, frame) => {
    const { dst } = instruction;
    const [first, ...rest] = instruction.elements;
    const grown = first?.kind === 'spread' && growsInPlace(frame, first.value, dst);
    const elements = (grown ? rest : instruction.elements).flatMap((element) => {
      const value = readRegister(frame, element.value);
      return element.kind === 'item' ? [value] : elementsOf(value);
    });
    if (grown) {
      next(frame, dst, frame.heap.values.appended(readRegister(frame, dst), elements));
    } else {
      built(frame, dst, { kind: 'array', elements });
    }
  },
  map: (_machine, instruction, frame) => {
    const { dst } = instruction;
    const [first, ...rest] = instruction.entries;
    const grown = first?.kind === 'spread' && growsInPlace(frame, first.value, dst);
    const entries = (grown ? rest : instruction.entries).flatMap(
      (entry): (readonly [Value, Value])[] => {
        if (entry.kind === 'entry') {
          return [[readRegister(frame, entry.key), readRegister(frame, entry.value)]];
        }
        return [...mapValueOf(readRegister(frame, entry.value)).entries];
      },
    );
    if (grown) {
      next(frame, dst, frame.heap.values.withEntries(readRegister(frame, dst), entries));
    } else {
      built(frame, dst, mapOf(entries));
    }
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
  currentCall: (machine, instruction, frame) => {
    next(frame, instruction.dst, machine.currentCall());
  },
  given: (_machine, instruction, frame) => {
    frame.pc =
      frame.registers[instruction.parameter] === undefined ? frame.pc + 1 : instruction.target;
  },
  body: (machine, _instruction, frame) => {
    if (frame.handsOver === true) {
      machine.handOver(frame);
      return;
    }
    frame.pc += 1;
  },
  select: (machine, instruction, frame) => {
    if (instruction.otherwise === undefined) {
      machine.wait();
      return;
    }
    const decision = machine.endWait();
    releaseLosers(frame, decision?.position);
    enterCase(frame, instruction, decision);
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
    writeRegister(
      frame,
      into,
      frame.registers[into] === undefined
        ? frame.heap.values.made({ kind: 'array', elements: kept })
        : frame.heap.values.appended(readRegister(frame, into), kept),
    );
    frame.pc += 1;
  },
};

/** The function a `call` runs, with the captures of a closure called as a value. */
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

/**
 * Whether a build spreading `source` first into `dst` grows the value in `dst` itself: one register,
 * holding its value directly rather than through a reference.
 */
function growsInPlace(frame: ActiveFrame, source: Register, dst: Register): boolean {
  const contents = frame.registers[dst];
  return source === dst && contents !== undefined && !isReference(contents);
}

/** Writes `value`, which the instruction built, to `dst`: the instance's own (lifetimes/in-place.ts). */
function built(frame: ActiveFrame, dst: number, value: CompositeValue): void {
  next(frame, dst, frame.heap.values.made(value));
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
