/**
 * The checks a Definition's shape can't express, so the interpreter can trust what it reads:
 * - every index lands inside its table
 * - every construction agrees with the type it names
 * - every call to a known function passes its parameters' number and kind (value or `&`), and
 *   every closure carries its function's captures
 * - code never runs off its end, and only code running as an execution waits
 * - an entry marks where its body begins exactly when a call may leave a parameter out, and its
 *   prologue's tests stand before that mark (../instructions/prologue.ts)
 *
 * Instructions are walked through `operandsOf` for indexes; the rules about particular
 * instructions live in instruction-rules.ts. Each problem becomes a zod issue at the path of the
 * offending entry, so a FormatError points at, say, `functions[3].instructions[12]`.
 */

import type { z } from 'zod';
import { isMainShaped, isStartable, type StartShape } from '../../foundation/language/starts.ts';
import { terminates } from '../instructions/flow.ts';
import { type Operands, operandsOf } from '../instructions/instruction.ts';
import { type CodeFunction, encoderProblem, type FunctionDefinition } from '../tables/functions.ts';
import type { Tables } from '../tables/index.ts';
import { runnerArity } from '../tables/test-runner.ts';
import { hasRole, type TypeDefinition, typesIn } from '../tables/types.ts';
import {
  type CompositeValue,
  childValues,
  handlesIn,
  isComposite,
  type Value,
} from '../values/values.ts';
import { closureProblem, constructionProblem, instructionProblem } from './instruction-rules.ts';

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
  checkStarts(context);
  checkTests(context);
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

/**
 * The Definition's `main` field (the paths below name it), which must point at code running as an
 * execution.
 */
function checkMain(context: Context): void {
  const { main } = context.tables;
  if (main === undefined || !inRange(context, { functions: [main] }, ['main'])) {
    return;
  }
  const entry = context.tables.functions[main];
  if (entry?.kind !== 'code' || !isMainShaped(startShapeOf(entry))) {
    context.report(['main'], 'main must be live code running as an execution, with no parameters.');
  }
}

/**
 * The entries a host may start: code taking every argument by value, each key named once, each with
 * an entry that can encode its outcome.
 */
function checkStarts(context: Context): void {
  const keys = new Set<string>();
  context.tables.starts.forEach((start, index) => {
    const path = ['starts', index];
    if (keys.has(start.key)) {
      context.report(path, `The key '${start.key}' names two entries a host may start.`);
    }
    keys.add(start.key);
    const entry = context.tables.functions[start.function];
    if (
      inRange(context, { functions: [start.function] }, [...path, 'function']) &&
      (entry?.kind !== 'code' || !isStartable(startShapeOf(entry)))
    ) {
      context.report(path, 'A host starts live or simple code that takes every argument by value.');
    }
    checkEncoder(context, start.encoder, [...path, 'encoder']);
  });
}

/** An entry encoding an instance's outcome for its host (§9): one that can. */
function checkEncoder(context: Context, encoder: number, path: Path): void {
  const entry = context.tables.functions[encoder];
  const problem = entry === undefined ? undefined : encoderProblem(entry);
  if (inRange(context, { functions: [encoder] }, path) && problem !== undefined) {
    context.report(path, `${problem}.`);
  }
}

/** A test Definition's suites and runner (§10): code entries, a suite's taking nothing. */
function checkTests(context: Context): void {
  const { tests } = context.tables;
  if (tests === undefined) {
    return;
  }
  const { list, run, suites } = tests;
  const named = (path: Path, function_: number, parameters: number) => {
    if (!inRange(context, { functions: [function_] }, path)) {
      return;
    }
    const entry = context.tables.functions[function_];
    if (entry?.kind !== 'code' || entry.parameters.length !== parameters) {
      context.report(path, `This names no code taking ${parameters} arguments.`);
    }
  };
  named(['tests', 'list'], list, runnerArity.list);
  named(['tests', 'run'], run, runnerArity.run);
  suites.forEach((suite, index) => {
    named(['tests', 'suites', index, 'function'], suite.function, 0);
  });
}

function checkType(context: Context, type: TypeDefinition, path: Path): void {
  inRange(context, { types: type.arguments.flatMap(typesIn) }, [...path, 'arguments']);
  if (type.kind === 'extern') {
    const { disposal, encoder } = type;
    if (encoder !== undefined) {
      checkEncoder(context, encoder, [...path, 'encoder']);
      if (type.role !== 'instance') {
        context.report([...path, 'encoder'], "Only an Instance's type entry encodes an outcome.");
      }
    }
    if (disposal.kind === 'function') {
      inRange(context, { functions: [disposal.function] }, [...path, 'disposal']);
      const { host } = disposal;
      if (
        host !== undefined &&
        inRange(context, { functions: [host] }, [...path, 'disposal', 'host']) &&
        context.tables.functions[host]?.kind !== 'extern'
      ) {
        context.report([...path, 'disposal', 'host'], "A host's dispose is an extern entry.");
      }
    }
    return;
  }
  if (type.kind === 'alias') {
    inRange(context, { types: typesIn(type.type) }, [...path, 'type']);
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
    if (!hasRole(context.tables.types, cell.type, 'cell')) {
      context.report(at, `Type ${cell.type} is not a cell type.`);
    }
  });
  const last = entry.instructions.at(-1);
  if (last !== undefined && !terminates(last)) {
    context.report(
      [...path, 'instructions'],
      'Code must end in return, jump, branch, switch or select.',
    );
  }
  checkPrologue(context, entry, path);
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

/**
 * `entry`'s prologue: one `body` marker when a call may leave a parameter out, so the runtime finds
 * where a mock takes over (§10), none otherwise, and every `given` before it.
 */
function checkPrologue(context: Context, entry: CodeFunction, path: Path): void {
  const marks = entry.instructions.flatMap((instruction, pc) =>
    instruction.kind === 'body' ? [pc] : [],
  );
  const computes = entry.parameters.some((parameter) => parameter.hasDefault);
  if (marks.length !== (computes ? 1 : 0)) {
    context.report(
      [...path, 'instructions'],
      computes
        ? `An entry computing defaults marks where its body begins once, not ${marks.length} times.`
        : 'An entry computing no defaults has no prologue to mark the end of.',
    );
    return;
  }
  const [mark = 0] = marks;
  entry.instructions.forEach((instruction, pc) => {
    if (instruction.kind === 'given' && pc > mark) {
      context.report([...path, 'instructions', pc], 'given: it stands past where the body begins.');
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

type ValueStep =
  | { readonly kind: 'visit'; readonly value: Value }
  | { readonly kind: 'enter'; readonly index: number }
  | { readonly kind: 'leave' };

/**
 * Every way `value`, at any depth, doesn't fit `tables`: an index out of range, or a construction
 * that disagrees with the type it names. A snapshot's values are checked the same way.
 */
export function valueProblems(tables: Tables, value: Value): readonly ValueProblem[] {
  const found: ValueProblem[] = [];
  const path: number[] = [];
  const pending: ValueStep[] = [{ kind: 'visit', value }];
  for (let step = pending.pop(); step !== undefined; step = pending.pop()) {
    if (step.kind === 'enter') {
      path.push(step.index);
    } else if (step.kind === 'leave') {
      path.pop();
    } else if (isComposite(step.value)) {
      found.push(...ownValueProblems(tables, step.value, path));
      pushChildren(step.value, pending);
    }
  }
  return found;
}

function ownValueProblems(
  tables: Tables,
  value: CompositeValue,
  path: readonly number[],
): readonly ValueProblem[] {
  const problems = outOfRange(tables, indexesOf(value));
  const rule = problems.length === 0 ? valueProblem(tables, value) : undefined;
  return (rule === undefined ? problems : [rule]).map((problem) => ({
    path: [...path],
    message: `${value.kind}: ${problem}`,
  }));
}

function pushChildren(value: CompositeValue, pending: ValueStep[]): void {
  const children = childValues(value);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    pending.push(
      { kind: 'leave' },
      { kind: 'visit', value: children[index] as Value },
      { kind: 'enter', index },
    );
  }
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

/** What the rule of what a host may start reads of a code entry: concrete code with its body. */
function startShapeOf(entry: CodeFunction): StartShape {
  return {
    hasBody: true,
    isStatic: false,
    isGeneric: false,
    parameters: entry.parameters,
    awaits: entry.mode !== 'simple',
    isIsta: entry.mode === 'ista',
  };
}
