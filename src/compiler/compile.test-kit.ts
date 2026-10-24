/**
 * Whole programs compiled as an app compiles them, with every std module, for the tests of phases
 * that start from a Definition: the runtime and its scheduler run real programs without anyone
 * writing their instructions by hand.
 */

import { definitionFormat } from '../definition/definition.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { compileProgram, diagnose } from './compile.ts';
import { type Files, idOf } from './program/program.test-kit.ts';

/** The Definition text of the program rooted at `main`, beside `others`; throws on any error. */
export function compiledText(main: string, others: Files = {}): string {
  const program = stdProgramOf({ main, ...others });
  const compilation = compileProgram(program, idOf('main'));
  if (compilation.kind !== 'compiled') {
    const messages = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
      diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`),
    );
    throw new Error(`The program doesn't compile (${compilation.kind}): ${messages.join('; ')}`);
  }
  return definitionFormat.write(compilation.definition).text;
}
