/**
 * Which registers of one function's code hold only what reaches no disposable (spec §7), so a
 * runtime counting holders per register needn't count them (definition/tables/functions.ts
 * `counted`).
 *
 * - **By type:** a register lowering bound to values of a type reaching no disposable
 *   (`CodeWriter.holdsPlain`). Types decide; nothing written there is checked again.
 * - **By what is written:** any other register is plain when every write to it builds its value
 *   only from plain registers: a part of a plain value, a value made of plain ones, a constant, a
 *   comparison. That holds of a temporary lowering never typed, such as a read through a handle.
 *   It is the greatest such set, checked by induction over a run: every register starts empty, and
 *   each write keeps what it writes plain while what it reads is. A parameter or capture, written
 *   by the caller, is plain by type alone, as is anything a call, a wait or the runtime gives, and a
 *   cell register: the cell it holds is counted by its type, whatever is written into it.
 */

import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { Register } from '../../../definition/operands.ts';
import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';

/** One register an instruction writes, and the registers its value is made of; opaque when unknown. */
interface Write {
  readonly register: Register;
  readonly from: readonly Register[] | 'opaque';
}

const madeOf = (register: Register, from: readonly Register[]): readonly Write[] => [
  { register, from },
];
const opaque = (register: Register): readonly Write[] => [{ register, from: 'opaque' }];
const none: readonly Write[] = [];

const writes: Handlers<undefined, Instruction, [], readonly Write[]> = {
  constant: (_, i) => madeOf(i.dst, []),
  contextConstant: (_, i) => opaque(i.dst),
  makeContextConstant: () => none,
  transient: (_, i) => opaque(i.dst),
  move: (_, i) => madeOf(i.dst, [i.src]),
  tuple: (_, i) => madeOf(i.dst, i.elements),
  struct: (_, i) => madeOf(i.dst, i.fields),
  variant: (_, i) => madeOf(i.dst, i.fields),
  field: (_, i) => madeOf(i.dst, [i.src]),
  store: (_, i) => madeOf(i.place.register, [i.place.register, i.value]),
  newCell: (_, i) => opaque(i.dst),
  readCell: (_, i) => madeOf(i.dst, [i.cell]),
  // What is behind the handle is part of the handle's register's value, as a store's part is: a
  // write through the reference is one of the handle's.
  behind: (_, i) => [...madeOf(i.dst, [i.handle]), ...madeOf(i.handle, [i.handle, i.dst])],
  array: (_, i) =>
    madeOf(
      i.dst,
      i.elements.map(({ value }) => value),
    ),
  map: (_, i) =>
    madeOf(
      i.dst,
      i.entries.flatMap((entry) =>
        entry.kind === 'entry' ? [entry.key, entry.value] : [entry.value],
      ),
    ),
  closure: (_, i) => madeOf(i.dst, i.captures),
  currentClosure: (_, i) => opaque(i.dst),
  equal: (_, i) => madeOf(i.dst, []),
  not: (_, i) => madeOf(i.dst, []),
  order: (_, i) => madeOf(i.dst, []),
  jump: () => none,
  branch: () => none,
  switch: () => none,
  return: () => none,
  given: () => none,
  body: () => none,
  call: (_, i) => [
    ...(i.dst === undefined ? [] : opaque(i.dst)),
    ...i.arguments.flatMap((argument) =>
      argument.kind === 'reference' ? opaque(argument.place.register) : [],
    ),
  ],
  // A weak reference holds nothing.
  currentCall: (_, i) => madeOf(i.dst, []),
  wait: (_, i) => opaque(i.dst),
  resolver: (_, i) => opaque(i.dst),
  await: (_, i) => opaque(i.dst),
  select: (_, i) => i.cases.flatMap(({ bind }) => (bind === undefined ? [] : opaque(bind))),
  release: () => none,
  keep: (_, i) => madeOf(i.into, [...i.registers, i.into]),
};

/** A frame's registers whose plainness only their types say: the caller's, and the cells. */
export interface TypedOnly {
  /** How many registers the caller fills: the parameters, then the captures. */
  readonly inputs: number;
  readonly cells: readonly Register[];
}

/**
 * The registers of `instructions` holding only what reaches no disposable: those `typed` says, and
 * those every write builds from plain ones alone, but those `typedOnly` names.
 */
export function plainRegisters(
  instructions: readonly Instruction[],
  registers: number,
  typedOnly: TypedOnly,
  typed: ReadonlySet<Register>,
): ReadonlySet<Register> {
  const plain = new Set(typed);
  const cells = new Set(typedOnly.cells);
  for (let register = typedOnly.inputs; register < registers; register += 1) {
    if (!cells.has(register)) {
      plain.add(register);
    }
  }
  const written = instructions.flatMap((instruction) =>
    handlerOf(writes, instruction)(undefined, instruction).filter(
      ({ register }) => !typed.has(register),
    ),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const { register, from } of written) {
      if (plain.has(register) && (from === 'opaque' || from.some((each) => !plain.has(each)))) {
        plain.delete(register);
        changed = true;
      }
    }
  }
  return plain;
}
