/**
 * The instruction set: one discriminated union over every family, and what each instruction
 * points at.
 *
 * `operandsOf` is a typed table with one entry per kind, so adding an instruction fails
 * compilation until its operands are listed. Everything that walks references (validation now,
 * tooling later) uses it instead of knowing instruction shapes.
 */

import { z } from 'zod';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { ConstantId, FunctionId, Label, Register, TypeId } from '../operands.ts';
import { type Callee, callInstructions } from './calls.ts';
import { controlInstructions } from './control.ts';
import { dataInstructions } from './data.ts';
import { lifetimeInstructions } from './lifetimes.ts';
import type { Argument, Place } from './places.ts';
import { suspensionInstructions } from './suspension.ts';

export const instruction = z.discriminatedUnion('kind', [
  ...dataInstructions,
  ...controlInstructions,
  ...callInstructions,
  ...suspensionInstructions,
  ...lifetimeInstructions,
]);

export type Instruction = z.output<typeof instruction>;

export type InstructionKind = Instruction['kind'];

/** Everything an instruction refers to, by table. */
export interface Operands {
  readonly registers: readonly Register[];
  readonly labels: readonly Label[];
  readonly functions: readonly FunctionId[];
  readonly types: readonly TypeId[];
  readonly constants: readonly ConstantId[];
}

const operandTable: Handlers<undefined, Instruction, [], Partial<Operands>> = {
  constant: (_, i) => ({ registers: [i.dst], constants: [i.constant] }),
  move: (_, i) => ({ registers: [i.dst, i.src] }),
  tuple: (_, i) => ({ registers: [i.dst, ...i.elements] }),
  struct: (_, i) => ({ registers: [i.dst, ...i.fields], types: [i.type] }),
  variant: (_, i) => ({ registers: [i.dst, ...i.fields], types: [i.type] }),
  field: (_, i) => ({ registers: [i.dst, i.src] }),
  store: (_, i) => merge(placeOperands(i.place), { registers: [i.value] }),
  newCell: (_, i) => ({ registers: [i.dst, i.value], types: [i.type] }),
  readCell: (_, i) => ({ registers: [i.dst, i.cell] }),
  writeCell: (_, i) => ({ registers: [i.cell, i.value] }),
  array: (_, i) => ({ registers: [i.dst, ...i.elements.map((element) => element.value)] }),
  map: (_, i) => ({
    registers: [
      i.dst,
      ...i.entries.flatMap((entry) =>
        entry.kind === 'entry' ? [entry.key, entry.value] : [entry.value],
      ),
    ],
  }),
  closure: (_, i) => ({ registers: [i.dst, ...i.captures], functions: [i.function] }),
  currentClosure: (_, i) => ({ registers: [i.dst] }),
  equal: (_, i) => ({ registers: [i.dst, i.left, i.right] }),
  not: (_, i) => ({ registers: [i.dst, i.src] }),
  order: (_, i) => ({ registers: [i.dst, i.comparison] }),
  jump: (_, i) => ({ labels: [i.target] }),
  branch: (_, i) => ({ registers: [i.condition], labels: [i.whenTrue, i.whenFalse] }),
  switch: (_, i) => ({
    registers: [i.value],
    labels: [...i.targets, ...(i.otherwise === undefined ? [] : [i.otherwise])],
  }),
  return: (_, i) => ({ registers: [i.value] }),
  call: (_, i) =>
    merge(
      { registers: i.dst === undefined ? [] : [i.dst] },
      calleeOperands(i.callee),
      ...i.arguments.map(argumentOperands),
    ),
  spawn: (_, i) => merge({ registers: i.arguments }, calleeOperands(i.callee)),
  currentCall: (_, i) => ({ registers: [i.dst] }),
  await: (_, i) => ({ registers: [i.dst, i.future] }),
  select: (_, i) => ({
    registers: i.cases.flatMap((c) => [
      c.future,
      ...c.holds,
      ...(c.bind === undefined ? [] : [c.bind]),
    ]),
    labels: [...i.cases.map((c) => c.target), ...(i.otherwise === undefined ? [] : [i.otherwise])],
  }),
  release: (_, i) => ({ registers: i.registers }),
  keep: (_, i) => ({ registers: [...i.registers, i.into] }),
  defer: (_, i) => ({ registers: [i.dst, i.callback] }),
};

/** What an instruction refers to, by table. */
export function operandsOf(subject: Instruction): Operands {
  return merge(handlerOf(operandTable, subject)(undefined, subject));
}

/** What a `call` or `spawn` names as its callee: a function, or the register of a function value. */
function calleeOperands(callee: Callee): Partial<Operands> {
  return callee.kind === 'function'
    ? { functions: [callee.function] }
    : { registers: [callee.register] };
}

function argumentOperands(argument: Argument): Partial<Operands> {
  return argument.kind === 'value'
    ? { registers: [argument.register] }
    : placeOperands(argument.place);
}

function placeOperands(place: Place): Partial<Operands> {
  return { registers: [place.register] };
}

function merge(...parts: readonly Partial<Operands>[]): Operands {
  return {
    registers: parts.flatMap((part) => part.registers ?? []),
    labels: parts.flatMap((part) => part.labels ?? []),
    functions: parts.flatMap((part) => part.functions ?? []),
    types: parts.flatMap((part) => part.types ?? []),
    constants: parts.flatMap((part) => part.constants ?? []),
  };
}
