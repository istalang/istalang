/**
 * `ista run <entry>`: compile the program rooted at `entry` and run its `async fn main()` (§9),
 * printing the outcome as JSON.
 *
 * Nothing runs unless the whole program checks clean. Its diagnostics, warnings included, go to
 * the error stream as `check` renders them, so the output holds only the outcome. Exit codes: 0
 * when `main` finishes, 1 when the program has errors, declares no `main`, or panics, and 2 when
 * the entry can't be read.
 */

import { compileProgram, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { FormatError } from '../../definition/format.ts';
import { createRuntime } from '../../runtime/host.ts';
import { Refusal } from '../../runtime/refusal.ts';
import { preludeNatives } from '../../stdlib/prelude/natives.ts';
import type { CliEnvironment, CommandDefinition } from '../command.ts';
import { loadProject } from '../project.ts';
import { reportDiagnostics } from '../report.ts';

export const defineRunCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('run')
    .description("run a program's async fn main() and print its outcome")
    .argument('<entry>', 'the module declaring main')
    .action((entry: string) => {
      exitWith(run(entry, environment));
    });
};

function run(entry: string, environment: CliEnvironment): number {
  const { program, unreadable } = loadProject(environment.cwd, [entry]);
  const [root] = program.roots;
  if (unreadable.length > 0 || root === undefined) {
    environment.writeError(`ista: no such file: ${entry}\n`);
    return 2;
  }
  reportDiagnostics(diagnose(program).values(), environment.writeError);
  const compilation = compileProgram(program, root);
  switch (compilation.kind) {
    case 'failed':
      return 1;
    case 'noMain':
      environment.writeError(`ista: ${entry} declares no 'async fn main()'.\n`);
      return 1;
    case 'compiled':
      return runMain(definitionFormat.write(compilation.definition).text, environment);
    default: {
      const unhandled: never = compilation;
      return unhandled;
    }
  }
}

/**
 * Runs a compiled program and prints its outcome. The runtime refuses a Definition it can't run,
 * and an outcome without a JSON form yet; each is reported as the command failing. Anything else
 * the runtime throws is a bug in the toolchain and propagates with its stack.
 */
function runMain(definition: string, environment: CliEnvironment): number {
  const program = unlessRefused(environment, () =>
    createRuntime({ natives: preludeNatives }).load(definition),
  );
  if (program === undefined) {
    return 1;
  }
  const outcome = program.run();
  if (outcome.kind === 'panicked') {
    environment.writeError(`panic: ${outcome.message}\n${outcome.trace}\n`);
    return 1;
  }
  const json = unlessRefused(environment, () => program.json(outcome.value));
  if (json === undefined) {
    return 1;
  }
  environment.write(`${json}\n`);
  return 0;
}

/** What `action` gives; undefined after reporting the refusal it threw (runtime/refusal.ts). */
function unlessRefused<Result>(
  environment: CliEnvironment,
  action: () => Result,
): Result | undefined {
  try {
    return action();
  } catch (error) {
    if (!(error instanceof Refusal || error instanceof FormatError)) {
      throw error;
    }
    environment.writeError(`ista: ${error.message}\n`);
    return undefined;
  }
}
