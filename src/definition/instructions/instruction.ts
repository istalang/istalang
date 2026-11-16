/**
 * The instruction set: one discriminated union over every family, and what each instruction
 * points at.
 *
 * `operandsOf` is a typed table with one entry per kind, so adding an instruction fails
 * compilation until its operands are listed. Everything that walks references (validation, the
 * ownership verifier, codegen's register analyses) uses it instead of knowing instruction shapes.
 */

import { z } from 'zod';
import { type Handlers, handlerOf } from '../../foundation/structures/handlers.ts';
import type { ConstantId, FunctionId, Label, Register, TypeId } from '../operands.ts';
import { callInstructions } from './calls.ts';
import { controlInstructions } from './control.ts';
import { dataInstructions } from './data.ts';
import { lifetimeInstructions } from './lifetimes.ts';
import { type Place, placeInstructions } from './places.ts';
import { suspensionInstructions } from './suspension.ts';

export const instruction = z.discriminatedUnion('kind', [
  ...dataInstructions,
  ...placeInstructions,
  ...controlInstructions,
  ...callInstructions,
  ...suspensionInstructions,
  ...lifetimeInstructions,
]);

export type Instruction = z.output<typeof instruction>;

export type InstructionKind = Instruction['kind'];

/** One kind of instruction. */
export type InstructionOf<Kind extends InstructionKind> = Extract<Instruction, { kind: Kind }>;

/** Everything an instruction refers to, by table; `written` are the registers it writes. */
export interface Operands {
  readonly read: readonly Register[];
  readonly written: readonly Register[];
  readonly labels: readonly Label[];
  readonly functions: readonly FunctionId[];
  readonly types: readonly TypeId[];
  readonly constants: readonly ConstantId[];
}

const operandTable: Handlers<undefined, Instruction, [], Partial<Operands>> = {
  constant: (_, i) => ({ written: [i.dst], constants: [i.constant] }),
  move: (_, i) => ({ written: [i.dst], read: [i.src] }),
  copy: (_, i) => ({ written: [i.dst], read: [i.src] }),
  tuple: (_, i) => ({ written: [i.dst], read: i.elements }),
  struct: (_, i) => ({ written: [i.dst], read: i.fields, types: [i.type] }),
  variant: (_, i) => ({ written: [i.dst], read: i.fields, types: [i.type] }),
  array: (_, i) => ({ written: [i.dst], read: i.elements.map((element) => element.value) }),
  map: (_, i) => ({
    written: [i.dst],
    read: i.entries.flatMap((entry) =>
      entry.kind === 'entry' ? [entry.key, entry.value] : [entry.value],
    ),
  }),
  closure: (_, i) => ({ written: [i.dst], read: i.captures, functions: [i.function] }),
  currentClosure: (_, i) => ({ written: [i.dst] }),
  tupleItem: (_, i) => ({ written: [i.dst], read: [i.src] }),
  structField: (_, i) => ({ written: [i.dst], read: [i.src] }),
  variantField: (_, i) => ({ written: [i.dst], read: [i.src] }),
  equal: (_, i) => ({ written: [i.dst], read: [i.left, i.right] }),
  not: (_, i) => ({ written: [i.dst], read: [i.src] }),
  order: (_, i) => ({ written: [i.dst], read: [i.comparison] }),
  primitive: (_, i) => ({ written: [i.dst], read: i.operands }),
  newCell: (_, i) => ({ written: [i.dst], read: [i.value] }),
  load: (_, i) => ({ written: [i.dst], read: [placeRoot(i.place)] }),
  store: (_, i) => ({ read: [placeRoot(i.place), i.value] }),
  reference: (_, i) => ({ written: [i.dst], read: [placeRoot(i.place)] }),
  transient: (_, i) => ({ written: [i.dst], labels: [i.target] }),
  contextConstant: (_, i) => ({ written: [i.dst], labels: [i.target] }),
  makeContextConstant: (_, i) => ({ read: [i.value] }),
  jump: (_, i) => ({ labels: [i.target] }),
  branch: (_, i) => ({ read: [i.condition], labels: [i.whenTrue, i.whenFalse] }),
  switch: (_, i) => ({
    read: [i.value],
    labels: [...i.targets, ...(i.otherwise === undefined ? [] : [i.otherwise])],
  }),
  return: (_, i) => ({ read: [i.value] }),
  unreachable: () => ({}),
  call: (_, i) => ({
    written: i.dst === undefined ? [] : [i.dst],
    read: [
      ...(i.callee.kind === 'value' ? [i.callee.register] : []),
      ...i.arguments.flatMap((argument) =>
        argument.kind === 'value' ? [argument.register] : [],
      ),
    ],
    functions: i.callee.kind === 'function' ? [i.callee.function] : [],
  }),
  currentCall: (_, i) => ({ written: [i.dst] }),
  given: (_, i) => ({ read: [i.parameter], labels: [i.target] }),
  mocked: (_, i) => ({ written: [i.dst], labels: [i.landing] }),
  park: (_, i) => ({ written: [i.dst], labels: [i.stop] }),
  stopped: () => ({}),
  letGo: (_, i) => ({ read: i.registers }),
};

/** What an instruction refers to, by table. */
export function operandsOf(subject: Instruction): Operands {
  const found = handlerOf(operandTable, subject)(undefined, subject);
  return {
    read: found.read ?? [],
    written: found.written ?? [],
    labels: found.labels ?? [],
    functions: found.functions ?? [],
    types: found.types ?? [],
    constants: found.constants ?? [],
  };
}

/** The register a place starts from. */
export function placeRoot(place: Place): Register {
  return place.root.register;
}

/** Whether control never goes on from `subject` to the instruction after it. */
export function endsBlock(subject: Instruction): boolean {
  switch (subject.kind) {
    case 'jump':
    case 'branch':
    case 'switch':
    case 'return':
    case 'stopped':
    case 'unreachable':
      return true;
    default:
      return false;
  }
}
