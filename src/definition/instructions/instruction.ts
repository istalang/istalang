/**
 * The instruction set: one discriminated union over every family, and what each instruction
 * points at.
 *
 * `operandsOf` is a typed table with one entry per kind, so adding an instruction fails
 * compilation until its operands are listed. Everything that walks references (validation now,
 * tooling later) uses it instead of knowing instruction shapes.
 */

import { z } from 'zod';
import type { ConstantId, FunctionId, Label, Register, TypeId } from '../operands.ts';
import { callInstructions } from './calls.ts';
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

type OperandTable = {
  readonly [Kind in InstructionKind]: (
    instruction: Extract<Instruction, { kind: Kind }>,
  ) => Partial<Operands>;
};

const operandTable: OperandTable = {
  constant: (i) => ({ registers: [i.dst], constants: [i.constant] }),
  move: (i) => ({ registers: [i.dst, i.src] }),
  tuple: (i) => ({ registers: [i.dst, ...i.elements] }),
  struct: (i) => ({ registers: [i.dst, ...i.fields], types: [i.type] }),
  variant: (i) => ({ registers: [i.dst, ...i.fields], types: [i.type] }),
  field: (i) => ({ registers: [i.dst, i.src] }),
  store: (i) => merge(placeOperands(i.place), { registers: [i.value] }),
  array: (i) => ({ registers: [i.dst, ...i.elements.map((element) => element.value)] }),
  map: (i) => ({
    registers: [
      i.dst,
      ...i.entries.flatMap((entry) =>
        entry.kind === 'entry' ? [entry.key, entry.value] : [entry.value],
      ),
    ],
  }),
  closure: (i) => ({ registers: [i.dst, ...i.captures], functions: [i.function] }),
  currentClosure: (i) => ({ registers: [i.dst] }),
  equal: (i) => ({ registers: [i.dst, i.left, i.right] }),
  not: (i) => ({ registers: [i.dst, i.src] }),
  order: (i) => ({ registers: [i.dst, i.comparison] }),
  jump: (i) => ({ labels: [i.target] }),
  branch: (i) => ({ registers: [i.condition], labels: [i.whenTrue, i.whenFalse] }),
  switch: (i) => ({ registers: [i.value], labels: i.targets }),
  return: (i) => ({ registers: [i.value] }),
  call: (i) =>
    merge(
      {
        registers: [
          ...(i.dst === undefined ? [] : [i.dst]),
          ...(i.callee.kind === 'value' ? [i.callee.register] : []),
        ],
        functions: i.callee.kind === 'function' ? [i.callee.function] : [],
      },
      ...i.arguments.map(argumentOperands),
    ),
  spawn: (i) => ({ registers: i.arguments, functions: [i.function] }),
  currentCall: (i) => ({ registers: [i.dst] }),
  await: (i) => ({ registers: [i.dst, i.future] }),
  select: (i) => ({
    registers: i.cases.flatMap((c) => [
      c.future,
      ...c.holds,
      ...(c.bind === undefined ? [] : [c.bind]),
    ]),
    labels: [...i.cases.map((c) => c.target), ...(i.otherwise === undefined ? [] : [i.otherwise])],
  }),
  release: (i) => ({ registers: i.registers }),
  keep: (i) => ({ registers: i.registers }),
  defer: (i) => ({ registers: [i.dst, i.callback] }),
};

/** What an instruction refers to, by table. */
export function operandsOf(subject: Instruction): Operands {
  const listed = (operandTable[subject.kind] as (i: Instruction) => Partial<Operands>)(subject);
  return merge(listed);
}

function argumentOperands(argument: Argument): Partial<Operands> {
  return argument.kind === 'value'
    ? { registers: [argument.register] }
    : placeOperands(argument.place);
}

function placeOperands(place: Place): Partial<Operands> {
  const elements = place.path.flatMap((step) => (step.kind === 'element' ? [step] : []));
  return {
    registers: [place.register, ...elements.map((step) => step.key)],
    functions: elements.flatMap((step) => [step.read, step.write]),
  };
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
