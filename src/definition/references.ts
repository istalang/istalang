/**
 * The checks a Definition's shape can't express, so the interpreter can trust what it reads:
 * - every index lands inside its table
 * - every construction agrees with the type it names
 * - every call to a known function passes its parameters' number and kind (value or `&`), and
 *   every closure carries its function's captures
 * - code never runs off its end, and only async functions wait
 *
 * Instructions are walked through `operandsOf` for indexes; the rules about particular
 * instructions live in instruction-rules.ts. Each problem becomes a zod issue at the path of the
 * offending entry, so a FormatError points at, say, `functions[3].instructions[12]`.
 */

import type { z } from 'zod';
import { type CodeFunction, type FunctionDefinition, sharedTypeName } from './functions.ts';
import { closureProblem, constructionProblem, instructionProblem } from './instruction-rules.ts';
import { terminates } from './instructions/flow.ts';
import { type Operands, operandsOf } from './instructions/instruction.ts';
import type { Tables } from './tables.ts';
import { type TypeDefinition, typesIn } from './types.ts';
import { type CompositeValue, childValues, handlesIn, isComposite, type Value } from './values.ts';

type Path = readonly (string | number)[];

/** The tables being checked, and where problems go. */
interface Context {
  readonly tables: Tables;
  readonly report: (path: Path, message: string) => void;
}

/** A zod refinement over a Definition's tables. */
export function checkReferences(tables: Tables, refinement: z.RefinementCtx): void {
  const context: Context = {
    tables,
    report: (path, message) => {
      refinement.addIssue({ code: 'custom', path: [...path], message });
    },
  };
  checkMain(context);
  tables.modules.forEach((module, index) => {
    const ascending = module.lineStarts.every((start, line) =>
      line === 0 ? start === 0 : start > (module.lineStarts[line - 1] ?? 0),
    );
    if (!ascending) {
      context.report(['modules', index, 'lineStarts'], 'Line starts begin at 0 and ascend.');
    }
  });
  tables.types.forEach((type, index) => {
    checkType(context, type, ['types', index]);
  });
  tables.functions.forEach((entry, index) => {
    checkFunction(context, entry, ['functions', index]);
  });
  tables.constants.forEach((constant, index) => {
    const path = ['constants', index];
    if (handlesIn(constant).length > 0) {
      context.report(path, 'A constant never contains a handle.');
    }
    checkValue(context, constant, path);
  });
}

function checkMain(context: Context): void {
  const { main } = context.tables;
  if (main === undefined || !inRange(context, { functions: [main] }, ['main'])) {
    return;
  }
  const entry = context.tables.functions[main];
  if (entry?.kind !== 'code' || !entry.async || entry.parameters.length > 0) {
    context.report(['main'], 'main must be an async function with code and no parameters.');
  }
}

function checkType(context: Context, type: TypeDefinition, path: Path): void {
  inRange(context, { types: type.arguments.flatMap(typesIn) }, [...path, 'arguments']);
  if (type.kind === 'extern') {
    const { disposal } = type;
    if (disposal.kind === 'function') {
      inRange(context, { functions: [disposal.function] }, [...path, 'disposal']);
    }
    return;
  }
  const fieldLists =
    type.kind === 'struct'
      ? [{ fields: type.fields, at: [...path, 'fields'] }]
      : type.variants.map((variant, index) => ({
          fields: variant.fields,
          at: [...path, 'variants', index, 'fields'],
        }));
  for (const { fields, at } of fieldLists) {
    fields.forEach((field, index) => {
      inRange(context, { types: typesIn(field.type) }, [...at, index, 'type']);
      field.annotations.forEach((annotation, position) => {
        checkValue(context, annotation, [...at, index, 'annotations', position]);
      });
    });
  }
}

function checkFunction(context: Context, entry: FunctionDefinition, path: Path): void {
  inRange(context, { modules: [entry.module] }, [...path, 'module']);
  entry.annotations.forEach((annotation, position) => {
    checkValue(context, annotation, [...path, 'annotations', position]);
  });
  if (entry.kind === 'extern') {
    if (entry.constant && entry.parameters.length > 0) {
      context.report(path, 'An extern constant takes no parameters.');
    }
    const types = [...entry.parameters.map((p) => p.type), entry.result, ...entry.typeArguments];
    inRange(context, { types: types.flatMap(typesIn) }, path);
    return;
  }
  checkCode(context, entry, path);
}

function checkCode(context: Context, entry: CodeFunction, path: Path): void {
  if (entry.parameters.length + entry.captures > entry.registers) {
    context.report([...path, 'registers'], 'Too few registers for the parameters and captures.');
  }
  const frame = { registers: entry.registers, labels: entry.instructions.length };
  entry.cells.forEach((cell, index) => {
    const at = [...path, 'cells', index];
    if (!inRange(context, { registers: [cell.register], types: [cell.type] }, at, frame)) {
      return;
    }
    const type = context.tables.types[cell.type];
    if (type?.kind !== 'extern' || type.name !== sharedTypeName) {
      context.report(at, `Type ${cell.type} is not a Shared<T> entry.`);
    }
  });
  const last = entry.instructions.at(-1);
  if (last !== undefined && !terminates(last)) {
    context.report(
      [...path, 'instructions'],
      'Code must end in return, jump, branch, switch or select.',
    );
  }
  entry.instructions.forEach((instruction, pc) => {
    const at = [...path, 'instructions', pc];
    const problems = outOfRange(context.tables, operandsOf(instruction), frame);
    const rule =
      problems.length === 0 ? instructionProblem(context.tables, entry, instruction) : undefined;
    for (const problem of rule === undefined ? problems : [rule]) {
      context.report(at, `${instruction.kind}: ${problem}`);
    }
  });
}

/** Indexes something refers to, by table; a table left out is not referred to. */
type Indexes = Partial<Operands> & { readonly modules?: readonly number[] };

interface Frame {
  readonly registers: number;
  readonly labels: number;
}

/**
 * The one range check for every index, in code, values, types and entries: each id against its
 * table's size, or for registers and labels against the frame's.
 */
function outOfRange(
  tables: Tables,
  indexes: Indexes,
  frame: Frame = { registers: 0, labels: 0 },
): readonly string[] {
  const limits = [
    ['register', indexes.registers, frame.registers],
    ['label', indexes.labels, frame.labels],
    ['module', indexes.modules, tables.modules.length],
    ['function', indexes.functions, tables.functions.length],
    ['type', indexes.types, tables.types.length],
    ['constant', indexes.constants, tables.constants.length],
  ] as const;
  return limits.flatMap(([what, ids = [], count]) =>
    ids.filter((id) => id >= count).map((id) => `${what} ${id} is out of range (${count}).`),
  );
}

/** Reports every out-of-range index at `path`; true when all are in range. */
function inRange(context: Context, indexes: Indexes, path: Path, frame?: Frame): boolean {
  const problems = outOfRange(context.tables, indexes, frame);
  for (const problem of problems) {
    context.report(path, problem);
  }
  return problems.length === 0;
}

function checkValue(context: Context, value: Value, path: Path): void {
  for (const problem of valueProblems(context.tables, value)) {
    context.report([...path, ...problem.path], problem.message);
  }
}

/** A problem with part of a value: where in the value, by child index, and what. */
export interface ValueProblem {
  readonly path: readonly number[];
  readonly message: string;
}

/**
 * Every way `value`, at any depth, doesn't fit `tables`: an index out of range, or a construction
 * that disagrees with the type it names. A snapshot's values are checked the same way.
 */
export function valueProblems(tables: Tables, value: Value): readonly ValueProblem[] {
  if (!isComposite(value)) {
    return [];
  }
  const problems = outOfRange(tables, indexesOf(value));
  const rule = problems.length === 0 ? valueProblem(tables, value) : undefined;
  const own = (rule === undefined ? problems : [rule]).map((problem) => ({
    path: [],
    message: `${value.kind}: ${problem}`,
  }));
  const children = childValues(value).flatMap((child, index) =>
    valueProblems(tables, child).map((problem) => ({ ...problem, path: [index, ...problem.path] })),
  );
  return [...own, ...children];
}

/** The table indexes a value refers to itself, not through its children. */
function indexesOf(value: CompositeValue): Operands {
  const none = { registers: [], labels: [], functions: [], types: [], constants: [] };
  switch (value.kind) {
    case 'struct':
    case 'variant':
    case 'extern':
      return { ...none, types: [value.type] };
    case 'closure':
      return { ...none, functions: [value.function] };
    default:
      return none;
  }
}

/** What is wrong with a value whose indexes are in range, if anything. */
function valueProblem(tables: Tables, value: CompositeValue): string | undefined {
  switch (value.kind) {
    case 'struct':
    case 'variant':
      return constructionProblem(tables, {
        shape: value.kind,
        type: value.type,
        variant: value.kind === 'variant' ? value.variant : 0,
        arity: value.fields.length,
      });
    case 'closure':
      return closureProblem(tables, value.function, value.captures.length);
    case 'extern':
      return tables.types[value.type]?.kind === 'extern'
        ? undefined
        : `type ${value.type} is not an extern type.`;
    default:
      return undefined;
  }
}
