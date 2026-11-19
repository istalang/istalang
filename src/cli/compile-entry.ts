/**
 * The program a command runs or builds (§17.1): the one rooted at the entry module, compiled once it
 * checks clean, which needs a `live async fn main()` there, and encoded. Diagnostics, warnings
 * included, go to the error stream as `check` renders them; what stopped it is an exit code.
 */

import { compileProgram, diagnose } from '../compiler/compile.ts';
import { type EncodedDefinition, encodeDefinition } from '../definition/definition.ts';
import { loadProject } from '../project/project.ts';
import { type CliEnvironment, type ExitCode, exitCodes } from './command.ts';
import { reportDiagnostics, reportUnreadable } from './report.ts';

/** The encoded Definition of the program rooted at `entry`, or the exit code for why there is none. */
export function compiledEntry(
  environment: CliEnvironment,
  entry: string,
): { readonly encoded: EncodedDefinition } | { readonly exit: ExitCode } {
  const { program, unreadable } = loadProject(environment.cwd, [entry]);
  const [root] = program.roots;
  if (unreadable.length > 0 || root === undefined) {
    reportUnreadable([entry], environment.writeError);
    return { exit: exitCodes.couldNotRun };
  }
  reportDiagnostics(diagnose(program), environment.writeError);
  const compilation = compileProgram(program, root);
  switch (compilation.kind) {
    case 'failed':
      return { exit: exitCodes.problems };
    case 'noMain':
      environment.writeError(`ista: ${entry} declares no 'live async fn main()'.\n`);
      return { exit: exitCodes.problems };
    case 'compiled':
      return { encoded: encodeDefinition(compilation.definition) };
    default: {
      const unhandled: never = compilation;
      return unhandled;
    }
  }
}
