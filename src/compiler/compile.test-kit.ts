/**
 * Whole programs compiled and diagnosed as an app does, for the tests of every phase from the
 * checker on: the runtime runs real programs without anyone writing their instructions by hand,
 * and a test reads one module's diagnostics by its key.
 *
 * A file checking or compiling many small programs checks the std modules once (`checkedAfterStd`),
 * each program's checker taking over their results as an editor's takes over what an edit left
 * alike; a program compiled to text is compiled once per test file.
 */

import {
  type EncodedDefinition,
  encodeDefinition,
  requireValid,
} from '../definition/definition.ts';
import type { Definition } from '../definition/tables/index.ts';
import { isError } from '../foundation/diagnostics/diagnostic.ts';
import { memo } from '../foundation/structures/memo.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { bindProgram } from './binder/bind.ts';
import { type Checker, checkProgram } from './checker/check.ts';
import { isCycle } from './checker/rules/lifetimes/lifetimes.test-kit.ts';
import { typeKeys } from './checker/types/identity/type-keys.ts';
import { compileProgram, diagnose, type ModuleDiagnostics, mainOf } from './compile.ts';
import { lower } from './lowering/lower.ts';
import { type Files, idOf } from './program/program.test-kit.ts';
import type { ModuleId, Program } from './program/program.ts';
import { nodesUnder } from './syntax/tree/index.ts';

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

/** The original `editedProgramOf` checked last, by its files' key: a test probes one at a time. */
let lastOriginal: { readonly key: string; readonly program: Program } | undefined;

/**
 * `files`, an edit of `original`, as `stdProgramOf` makes them, made as an editor makes an edit:
 * its trees keep the nodes the edit left alike (program.ts), and its checker takes over every
 * result that reads only those (check.ts `checkProgram`). `original`'s own modules are checked
 * after the std modules once, until another original is asked, so a test probing many edits of
 * one program checks each edit alone.
 */
export function editedProgramOf(files: Files, original: Files): Program {
  const key = filesKey(original);
  if (lastOriginal?.key !== key) {
    const program = stdProgramOf(original);
    const checker = checkedAfterStd(program);
    for (const name of Object.keys(original)) {
      checker.diagnosticsOf(idOf(name));
    }
    lastOriginal = { key, program };
  }
  const program = stdProgramOf(files, lastOriginal.program);
  checkProgram(program, { previous: lastOriginal.program });
  return program;
}

/** One key per set of files, whatever order their names were given in. */
function filesKey(files: Files): string {
  return JSON.stringify(Object.entries(files).sort());
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

/**
 * The timeout of a test that compiles whole programs, the std's Istalang included, case after case:
 * a property compiling, and most often running, a program per run, or a sweep checking a whole
 * corpus. Each program takes a tenth of a second or more, and suites of several worktrees run side
 * by side (vitest.config.ts), so such a test needs far more than the default.
 */
export const wholeProgramTimeout = 60_000;

const compiledPrograms = new Map<string, EncodedDefinition>();

/** `definition`, the compiler's, encoded as a deploy takes it, once validation holds it to its rules. */
function validEncoded(definition: Definition): EncodedDefinition {
  requireValid(definition);
  return encodeDefinition(definition);
}

/**
 * The encoded Definition of the program rooted at `main`, with every std module, though static
 * lifetimes rejects its cycles (design.md §7): lowering reads no verdict of the rule, so tests run
 * such programs anyway, those the rule over-rejects (docs/work/done/static-lifetimes/findings.md).
 * Throws at any other error.
 */
export function encodedDespiteCycles(main: string): EncodedDefinition {
  const program = stdProgramOf({ main });
  const checker = checkedAfterStd(program);
  const errors = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
    diagnostics.filter((diagnostic) => isError(diagnostic) && !isCycle(diagnostic)),
  );
  const entry = mainOf(program, idOf('main'));
  if (errors.length > 0 || entry === undefined) {
    throw new Error(`main doesn't compile: ${errors.map(({ message }) => message).join('; ')}`);
  }
  return validEncoded(lower(checker, entry));
}

/** The encoded Definition of the program rooted at `main`, beside `others`, with every std module. */
export function compiledEncoded(main: string, others: Files = {}): EncodedDefinition {
  const files = { main, ...others };
  return memo(compiledPrograms, filesKey(files), () => {
    const program = stdProgramOf(files);
    checkedAfterStd(program);
    return validEncoded(compiledDefinition(program, 'main'));
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

/**
 * Numbers the identities of `module`'s names and nodes, its last first, before checking `program`
 * numbers them in its own order: a Definition must not show which was numbered first.
 */
export function numberBackwards(program: Program, module: ModuleId): void {
  const tree = program.modules.get(module)?.tree;
  const bindings = bindProgram(program);
  for (const node of tree === undefined ? [] : nodesUnder(tree, tree.root).toReversed()) {
    const entity = node.kind === 'Identifier' ? bindings.entityOf(module, node) : undefined;
    typeKeys.identityOf(entity ?? node);
  }
}

/** Each diagnostic of `program` by module path, positions aside, as formatting a module moves them. */
export function diagnosticsWithoutPlaces(program: Program) {
  return [...diagnose(program).values()].flatMap(({ source, diagnostics }) =>
    diagnostics.map(({ severity, code, message }) => ({
      path: source.path,
      severity,
      code,
      message,
    })),
  );
}
