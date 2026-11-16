/**
 * Which loads are read past a write that may reach their place (§2; docs/arch/definition.md,
 * "Places"): a `load` borrows the value in a cell, which a write changes in place where nothing
 * else holds it, so a borrow still read after such a write would see the change. Each such load is
 * marked `readPastWrites`, which keeps its value as it was read (the value counts as shared).
 *
 * - **A borrow lasts** from its load to the last read of it or of a part read out of it, in code
 *   order: a temporary is read after it is made, within the code of its statement.
 * - **What may write** depends on the cell. A cell this entry made and uses only as a place's root
 *   is reached by nothing else, so only a store into it or a call given a reference into it writes
 *   it. Any other (a captured variable's, a shared struct's state, a `&` parameter's place) is
 *   reached by any code: every call but a native's taking no reference and no function, every
 *   store into a cell, every wait, and every let-go, whose disposals run code.
 * - It is decided over the whole function table, once every extern is known, so a call of a native
 *   that reads only its arguments never makes a borrow a copy.
 */

import {
  type Instruction,
  type Operands,
  operandsOf,
} from '../../../definition/instructions/instruction.ts';
import type { Register } from '../../../definition/operands.ts';
import type { CodeFunction, FunctionDefinition } from '../../../definition/tables/functions.ts';
import { memo } from '../../../foundation/structures/memo.ts';

type Load = Extract<Instruction, { kind: 'load' }>;

/** `functions`, each code entry's loads read past a write marked so. */
export function withLoadsPastWrites(
  functions: readonly FunctionDefinition[],
): FunctionDefinition[] {
  const readsOnly = (function_: number) => {
    const entry = functions[function_];
    return (
      entry?.kind === 'extern' &&
      entry.parameters.every(({ type }) => type.kind !== 'reference' && type.kind !== 'function')
    );
  };
  return functions.map((entry) =>
    entry.kind === 'code' ? withMarkedLoads(entry, readsOnly) : entry,
  );
}

/** `entry` with its loads read past a write marked, a call of what `readsOnly` names writing none. */
function withMarkedLoads(
  entry: CodeFunction,
  readsOnly: (function_: number) => boolean,
): CodeFunction {
  const { instructions } = entry;
  const operands = instructions.map(operandsOf);
  const local = localCells(instructions, operands);
  const localWrites = new Map<Register, (instruction: Instruction) => boolean>();
  let marked = false;
  const marking = instructions.map((instruction, at) => {
    if (
      instruction.kind !== 'load' ||
      instruction.place.root.kind === 'register' ||
      entry.registers[instruction.dst]?.borrowed !== true
    ) {
      return instruction;
    }
    const end = lastRead(instructions, operands, at);
    const root = instruction.place.root.register;
    const writes = local.has(root)
      ? memo(localWrites, root, () => writesLocalCell(instructions, root))
      : (each: Instruction) => writesAnyCell(each, readsOnly);
    if (!instructions.slice(at + 1, end + 1).some(writes)) {
      return instruction;
    }
    marked = true;
    return { ...instruction, readPastWrites: true } satisfies Load;
  });
  return marked ? { ...entry, instructions: marking } : entry;
}

/**
 * The cells `instructions` make (`newCell`) and use only as a place's root: no other code can
 * reach them.
 */
function localCells(
  instructions: readonly Instruction[],
  operands: readonly Operands[],
): ReadonlySet<Register> {
  const made = new Set(
    instructions.flatMap((instruction) =>
      instruction.kind === 'newCell' ? [instruction.dst] : [],
    ),
  );
  instructions.forEach((instruction, position) => {
    const rooted =
      instruction.kind === 'load' ||
      instruction.kind === 'reference' ||
      instruction.kind === 'store'
        ? instruction.place.root.register
        : undefined;
    const otherReads = (operands[position] as Operands).read.filter(
      (register, at, reads) => register !== rooted || reads.indexOf(register) !== at,
    );
    for (const register of otherReads) {
      made.delete(register);
    }
  });
  return made;
}

/** Where the borrow `instructions[at]` loads is read last, itself or a part read out of it. */
function lastRead(
  instructions: readonly Instruction[],
  operands: readonly Operands[],
  at: number,
): number {
  const borrows = new Set((operands[at] as Operands).written);
  let last = at;
  instructions.forEach((instruction, position) => {
    if (position <= at) {
      return;
    }
    const { read, written } = operands[position] as Operands;
    if (!read.some((register) => borrows.has(register))) {
      return;
    }
    last = position;
    if (readsPart(instruction)) {
      for (const register of written) {
        borrows.add(register);
      }
    }
  });
  return last;
}

/** Whether `instruction` borrows a part of the value it reads. */
function readsPart(instruction: Instruction): boolean {
  switch (instruction.kind) {
    case 'tupleItem':
    case 'structField':
    case 'variantField':
      return true;
    case 'load':
      return instruction.place.root.kind === 'register';
    default:
      return false;
  }
}

/** What writes the local cell `cell`: a store into it, or a call given a reference into it. */
function writesLocalCell(
  instructions: readonly Instruction[],
  cell: Register,
): (instruction: Instruction) => boolean {
  const references = new Set<Register>();
  for (const instruction of instructions) {
    if (
      instruction.kind === 'reference' &&
      (instruction.place.root.register === cell || references.has(instruction.place.root.register))
    ) {
      references.add(instruction.dst);
    }
  }
  return (instruction) => {
    switch (instruction.kind) {
      case 'store':
        return (
          instruction.place.root.register === cell ||
          references.has(instruction.place.root.register)
        );
      case 'call':
        return instruction.arguments.some(
          (argument) => argument.kind === 'value' && references.has(argument.register),
        );
      default:
        return false;
    }
  };
}

/** Whether `instruction` may write a cell other code reaches. */
function writesAnyCell(
  instruction: Instruction,
  readsOnly: (function_: number) => boolean,
): boolean {
  switch (instruction.kind) {
    case 'call':
      return instruction.callee.kind === 'value' || !readsOnly(instruction.callee.function);
    case 'store':
      return instruction.place.root.kind !== 'register';
    case 'park':
    case 'letGo':
      return true;
    default:
      return false;
  }
}
