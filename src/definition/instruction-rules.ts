/**
 * What load validation requires of single instructions beyond their indexes, so the interpreter
 * runs any accepted instruction without a guard of its own:
 * - a construction matches the type it names
 * - a direct call or `spawn` passes the callee's parameters in number and kind (value or `&`), and
 *   a function with captures is called only through its closure value, never directly
 * - a closure carries its function's captures
 * - a place's element steps name an `index` (container, key) and a `setIndex` (`&`container,
 *   key, value), which the runtime calls to read and write the element (spec §3.7, §3.9)
 * - only async code waits
 *
 * The rules are a typed table with one entry per instruction kind, like `operandsOf`
 * (instructions/instruction.ts): a new kind fails compilation until it has an entry, and a kind
 * without a rule says so with `none`. Each rule returns why an instruction breaks it, or
 * undefined; references.ts runs a rule only once the instruction's indexes are in range, and
 * reports the reason at the instruction's path. Construction and closure rules also apply to
 * constant values.
 */

import {
  type CodeFunction,
  capturesOf,
  type FunctionDefinition,
  takesReference,
} from './functions.ts';
import type { Instruction, InstructionKind } from './instructions/instruction.ts';
import type { Argument, Place } from './instructions/places.ts';
import type { Tables } from './tables.ts';

/** A struct or enum value being built: by an instruction or as a constant. */
export interface Construction {
  readonly shape: 'struct' | 'variant';
  readonly type: number;
  readonly variant: number;
  readonly arity: number;
}

type Rule<Kind extends InstructionKind> = (
  tables: Tables,
  owner: CodeFunction,
  instruction: Extract<Instruction, { kind: Kind }>,
) => string | undefined;

/** The rule of a kind that needs nothing beyond in-range indexes. */
const none = (): undefined => undefined;

const waitsOnlyInAsync = (_tables: Tables, owner: CodeFunction) =>
  owner.async ? undefined : 'only an async function can use it.';

const rules: { readonly [Kind in InstructionKind]: Rule<Kind> } = {
  constant: none,
  move: none,
  tuple: none,
  struct: (tables, _owner, i) =>
    constructionProblem(tables, {
      shape: 'struct',
      type: i.type,
      variant: 0,
      arity: i.fields.length,
    }),
  variant: (tables, _owner, i) =>
    constructionProblem(tables, {
      shape: 'variant',
      type: i.type,
      variant: i.variant,
      arity: i.fields.length,
    }),
  field: none,
  store: (tables, _owner, i) => placeProblem(tables, i.place),
  array: none,
  map: none,
  closure: (tables, _owner, i) => closureProblem(tables, i.function, i.captures.length),
  currentClosure: none,
  equal: none,
  not: none,
  order: none,
  jump: none,
  branch: none,
  switch: none,
  return: none,
  call: (tables, _owner, i) =>
    i.callee.kind === 'function'
      ? directCallProblem(tables, tables.functions[i.callee.function], i.arguments)
      : argumentPlacesProblem(tables, i.arguments),
  spawn: (tables, _owner, i) => spawnProblem(tables.functions[i.function], i.arguments.length),
  currentCall: waitsOnlyInAsync,
  await: waitsOnlyInAsync,
  select: (_tables, owner, i) =>
    owner.async || i.otherwise !== undefined
      ? undefined
      : 'only an async function can wait; a select without otherwise waits.',
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
  return (rules[instruction.kind] as Rule<InstructionKind>)(tables, owner, instruction as never);
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
  tables: Tables,
  callee: FunctionDefinition | undefined,
  args: readonly Argument[],
): string | undefined {
  if (callee !== undefined && capturesOf(callee) > 0) {
    return `${callee.name} has captures, so it is called through its closure value.`;
  }
  return argumentsProblem(callee, args) ?? argumentPlacesProblem(tables, args);
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

function argumentPlacesProblem(tables: Tables, args: readonly Argument[]): string | undefined {
  for (const argument of args) {
    const problem =
      argument.kind === 'reference' ? placeProblem(tables, argument.place) : undefined;
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

/** `index(container, key)` and `setIndex(&container, key, value)`, spec §3.9. */
const elementReadArity = 2;
const elementWriteArity = 3;

function placeProblem(tables: Tables, place: Place): string | undefined {
  const elements = place.path.flatMap((step) => (step.kind === 'element' ? [step] : []));
  for (const step of elements) {
    const read = tables.functions[step.read];
    const write = tables.functions[step.write];
    if (read !== undefined && read.parameters.length !== elementReadArity) {
      return `an element is read by ${read.name}, which must take a container and a key.`;
    }
    const writesThroughReference =
      write === undefined ||
      (write.parameters.length === elementWriteArity && takesReference(write, 0));
    if (write !== undefined && !writesThroughReference) {
      return `an element is written by ${write.name}, which must take &container, key and value.`;
    }
  }
  return undefined;
}
