/**
 * Whole programs compiled and diagnosed as an app does, for the tests of every phase from the
 * checker on: the runtime and its scheduler run real programs without anyone writing their
 * instructions by hand, and a test reads one module's diagnostics by its key.
 */

import type { Definition } from '../definition/definition.ts';
import { definitionFormat } from '../definition/definition.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { compileProgram, diagnose, type ModuleDiagnostics } from './compile.ts';
import { type Files, idOf } from './program/program.test-kit.ts';
import type { Program } from './program/program.ts';

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

/** The Definition text of the program rooted at `main`, beside `others`, with every std module. */
export function compiledText(main: string, others: Files = {}): string {
  return definitionFormat.write(compiledDefinition(stdProgramOf({ main, ...others }), 'main')).text;
}

/** The diagnostics of module `key` of `program`; throws when the program didn't load it. */
export function diagnosedAt(program: Program, key: string): ModuleDiagnostics {
  const result = diagnose(program).get(idOf(key));
  if (result === undefined) {
    throw new Error(`${key} was not loaded`);
  }
  return result;
}
