/**
 * What load validation requires of single instructions beyond their indexes, so the interpreter
 * runs any accepted instruction without a guard of its own:
 * - a construction matches the type it names
 * - a direct call or `spawn` passes the callee's parameters in number and kind (value or `&`), and
 *   a function with captures is called only through its closure value, never directly
 * - a closure carries its function's captures
 * - only async code waits
 *
 * The rules are a typed table with one entry per instruction kind, like `operandsOf`
 * (instructions/instruction.ts): a new kind fails compilation until it has an entry, and a kind
 * without a rule says so with `none`. Each rule returns why an instruction breaks it, or
 * undefined; references.ts runs a rule only once the instruction's indexes are in range, and
 * reports the reason at the instruction's path. Construction and closure rules also apply to
 * constant values.
 */

import { type Handlers, handlerOf } from '../structures/kind-table.ts';
import {
  type CodeFunction,
  capturesOf,
  type FunctionDefinition,
  takesReference,
} from './functions.ts';
import { waits } from './instructions/flow.ts';
import type { Instruction } from './instructions/instruction.ts';
import type { Argument } from './instructions/places.ts';
import type { Tables } from './tables.ts';

/** A struct or enum value being built: by an instruction or as a constant. */
export interface Construction {
  readonly shape: 'struct' | 'variant';
  readonly type: number;
  readonly variant: number;
  readonly arity: number;
}

/** The rule of a kind that needs nothing beyond in-range indexes. */
const none = (): undefined => undefined;

/** `currentCall` names the async call it runs in, so only async code has one. */
const asyncOnly = (_tables: Tables, _instruction: Instruction, owner: CodeFunction) =>
  owner.async ? undefined : 'only an async function can use it.';

const waitsOnlyInAsync = (_tables: Tables, instruction: Instruction, owner: CodeFunction) =>
  owner.async || !waits(instruction) ? undefined : 'only an async function can wait.';

const rules: Handlers<Tables, Instruction, [CodeFunction], string | undefined> = {
  constant: none,
  move: none,
  tuple: none,
  struct: (tables, i) =>
    constructionProblem(tables, {
      shape: 'struct',
      type: i.type,
      variant: 0,
      arity: i.fields.length,
    }),
  variant: (tables, i) =>
    constructionProblem(tables, {
      shape: 'variant',
      type: i.type,
      variant: i.variant,
      arity: i.fields.length,
    }),
  field: none,
  store: none,
  readCell: none,
  writeCell: none,
  array: none,
  map: none,
  closure: (tables, i) => closureProblem(tables, i.function, i.captures.length),
  currentClosure: none,
  equal: none,
  not: none,
  order: none,
  jump: none,
  branch: none,
  switch: none,
  return: none,
  call: (tables, i) =>
    i.callee.kind === 'function'
      ? directCallProblem(tables.functions[i.callee.function], i.arguments)
      : undefined,
  spawn: (tables, i) =>
    i.callee.kind === 'function'
      ? spawnProblem(tables.functions[i.callee.function], i.arguments.length)
      : undefined,
  currentCall: asyncOnly,
  await: waitsOnlyInAsync,
  select: waitsOnlyInAsync,
  release: none,
  keep: none,
  defer: none,
};

/** What is wrong with one instruction in `owner`, beyond its indexes, if anything. */
export function instructionProblem(
  tables: Tables,
  owner: CodeFunction,
  instruction: Instruction,
): string | undefined {
  return handlerOf(rules, instruction)(tables, instruction, owner);
}

/** Why a construction doesn't fit the type it names, if it doesn't. */
export function constructionProblem(
  tables: Tables,
  construction: Construction,
): string | undefined {
  const { shape, type: typeId, variant, arity } = construction;
  const type = tables.types[typeId];
  if (type?.kind !== (shape === 'struct' ? 'struct' : 'enum')) {
    return `type ${typeId} is not ${shape === 'struct' ? 'a struct' : 'an enum'}.`;
  }
  const fields = type.kind === 'struct' ? type.fields : type.variants[variant]?.fields;
  if (fields === undefined) {
    return `type ${typeId} has no variant ${variant}.`;
  }
  return fields.length === arity
    ? undefined
    : `type ${typeId} takes ${fields.length} fields, not ${arity}.`;
}

/** Why a closure of `functionId` can't carry `captures` values, if it can't. */
export function closureProblem(
  tables: Tables,
  functionId: number,
  captures: number,
): string | undefined {
  const target = tables.functions[functionId];
  if (target === undefined || capturesOf(target) === captures) {
    return undefined;
  }
  return `a closure of ${target.name} carries ${capturesOf(target)} captures, not ${captures}.`;
}

function directCallProblem(
  callee: FunctionDefinition | undefined,
  args: readonly Argument[],
): string | undefined {
  if (callee !== undefined && capturesOf(callee) > 0) {
    return `${callee.name} has captures, so it is called through its closure value.`;
  }
  return argumentsProblem(callee, args);
}

function spawnProblem(target: FunctionDefinition | undefined, arity: number): string | undefined {
  if (target === undefined) {
    return undefined;
  }
  if (target.kind === 'extern' || target.captures > 0) {
    return `${target.name} can't be spawned: an instance starts a function with code and no captures.`;
  }
  const args = Array.from({ length: arity }, (_, register) => ({
    kind: 'value' as const,
    register,
  }));
  return argumentsProblem(target, args);
}

/** Why `args` don't fit `callee`'s parameters, if they don't. */
function argumentsProblem(
  callee: FunctionDefinition | undefined,
  args: readonly Argument[],
): string | undefined {
  if (callee === undefined) {
    return undefined;
  }
  if (args.length !== callee.parameters.length) {
    return `${callee.name} takes ${callee.parameters.length} arguments, not ${args.length}.`;
  }
  const mismatch = args.findIndex(
    (argument, index) => (argument.kind === 'reference') !== takesReference(callee, index),
  );
  if (mismatch < 0) {
    return undefined;
  }
  const expected = takesReference(callee, mismatch) ? 'by &' : 'by value';
  return `argument ${mismatch} of ${callee.name} must be passed ${expected}.`;
}
