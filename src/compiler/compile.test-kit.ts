/**
 * Whole programs compiled and diagnosed as an app does, for the tests of every phase from the
 * checker on: the runtime and its scheduler run real programs without anyone writing their
 * instructions by hand, and a test reads one module's diagnostics by its key.
 *
 * A file checking or compiling many small programs checks the std modules once (`checkedAfterStd`),
 * each program's checker taking over their results as an editor's takes over what an edit left
 * alike; a program compiled to text is compiled once per test file.
 */

import type { Definition } from '../definition/definition.ts';
import { definitionFormat } from '../definition/definition.ts';
import { isError } from '../foundation/diagnostics/diagnostic.ts';
import { memo } from '../foundation/structures/memo.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { type Checker, checkProgram } from './checker/check.ts';
import { isCycle } from './checker/rules/lifetimes/lifetimes.test-kit.ts';
import { compileProgram, diagnose, type ModuleDiagnostics, mainOf } from './compile.ts';
import { lower } from './lowering/lower.ts';
import { type Files, idOf } from './program/program.test-kit.ts';
import type { Program } from './program/program.ts';

let stdChecked: Program | undefined;

/**
 * The checker of `program`, made by `stdProgramOf`, made after the std modules every program loads
 * were checked whole, once per test file: it takes over their results wherever `program` leaves
 * them alike (check.ts `checkProgram`), so a file of many small programs checks them once. Call it
 * before anything else checks `program`, as a program keeps its first checker.
 */
export function checkedAfterStd(program: Program): Checker {
  stdChecked ??= checkedWhole(stdProgramOf({ 'std-only.ista': '' }));
  return checkProgram(program, { previous: stdChecked });
}

/** `program`, every module of it checked. */
function checkedWhole(program: Program): Program {
  const checker = checkProgram(program);
  for (const module of program.modules.keys()) {
    checker.diagnosticsOf(module);
  }
  return program;
}

/** The Definition of `program` run from module `entry`; throws, listing every diagnostic, when it doesn't compile. */
export function compiledDefinition(program: Program, entry: string): Definition {
  const compilation = compileProgram(program, idOf(entry));
  if (compilation.kind !== 'compiled') {
    const messages = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
      diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`),
    );
    throw new Error(`${entry} doesn't compile (${compilation.kind}): ${messages.join('; ')}`);
  }
  return compilation.definition;
}

const compiledTexts = new Map<string, string>();

/**
 * The Definition text of the program rooted at `main`, with every std module, though static
 * lifetimes rejects its cycles (design.md §7): lowering reads no verdict of the rule, so tests run
 * such programs anyway, the oracle checking their heaps. They are the oracle's own, whose programs
 * make cycles, and those the rule over-rejects (docs/work/static-lifetimes/findings.md). Throws
 * at any other error.
 */
export function textDespiteCycles(main: string): string {
  const program = stdProgramOf({ main });
  const checker = checkedAfterStd(program);
  const errors = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
    diagnostics.filter((diagnostic) => isError(diagnostic) && !isCycle(diagnostic)),
  );
  const entry = mainOf(program, idOf('main'));
  if (errors.length > 0 || entry === undefined) {
    throw new Error(`main doesn't compile: ${errors.map(({ message }) => message).join('; ')}`);
  }
  return definitionFormat.write(lower(checker, entry)).text;
}

/** The Definition text of the program rooted at `main`, beside `others`, with every std module. */
export function compiledText(main: string, others: Files = {}): string {
  const files = { main, ...others };
  return memo(compiledTexts, JSON.stringify(Object.entries(files).sort()), () => {
    const program = stdProgramOf(files);
    checkedAfterStd(program);
    return definitionFormat.write(compiledDefinition(program, 'main')).text;
  });
}

/** The diagnostics of module `key` of `program`; throws when the program didn't load it. */
export function diagnosedAt(program: Program, key: string): ModuleDiagnostics {
  const result = diagnose(program).get(idOf(key));
  if (result === undefined) {
    throw new Error(`${key} was not loaded`);
  }
  return result;
}
