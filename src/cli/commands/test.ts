/**
 * `ista test [paths…]` (§10): compile the test modules under the given files and directories, or
 * under the project root without any, into one program, and run each test of every `@Suite`
 * function in a fresh instance on a fresh runtime (runtime/testing/). Nothing runs unless the
 * whole program checks clean; diagnostics go to the error stream as `check` renders them.
 *
 * The output is one line per test, its mark and full title, a failure followed by its message,
 * trace and the log records its instances committed, then a count. A test waiting on a timer waits
 * on real time, unless it mocked time.
 * Exit codes: 0 when every test that ran passed; 1 when a module has errors, a test fails or no
 * test was found; 2 when a path can't be read or the options don't fit.
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileTests, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { testModuleSuffix } from '../../foundation/language/well-known/testing.ts';
import { findSources, loadProject } from '../../project/project.ts';
import { realTime } from '../../runtime/clock.ts';
import { runTests, type TestReport } from '../../runtime/testing/run-tests.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import {
  type CliEnvironment,
  type CommandDefinition,
  type ExitCode,
  exitCodes,
} from '../command.ts';
import { logLine } from '../log-lines.ts';
import { reportDiagnostics, reportUnreadable } from '../report.ts';

export interface TestOptions {
  readonly filter?: string;
  readonly timeout: string;
}

/** How long a test may run by default, in milliseconds (§10). */
const defaultTimeout = '5000';

/** A `--timeout`: a whole number of milliseconds. */
const milliseconds = /^\d+$/u;

const marks: Record<TestReport['outcome']['kind'], string> = {
  passed: '✓',
  failed: '✗',
  skipped: '-',
};

export const defineTestCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('test')
    .description("run the tests of the program's test modules")
    .argument('[paths...]', 'test modules, or directories to find them in (default: the project)')
    .option('--filter <text>', 'run only the tests whose full title contains this')
    .option('--timeout <ms>', 'how long one test may run', defaultTimeout)
    .action(async (paths: string[], options: TestOptions) => {
      exitWith(await testModules(paths, options, environment));
    });
};

/** Runs the tests of the test modules `paths` name, as `ista test` does; its exit code. */
export async function testModules(
  paths: readonly string[],
  options: TestOptions,
  environment: Pick<CliEnvironment, 'cwd' | 'write' | 'writeError'>,
): Promise<ExitCode> {
  const timeout = milliseconds.test(options.timeout) ? BigInt(options.timeout) : undefined;
  if (timeout === undefined || timeout === 0n) {
    environment.writeError(
      `ista: --timeout takes a number of milliseconds, not ${options.timeout}.\n`,
    );
    return exitCodes.couldNotRun;
  }
  const { cwd } = environment;
  const found = testModulesOf(cwd, paths.length > 0 ? paths : [cwd]);
  if (found.unreadable.length > 0) {
    reportUnreadable(found.unreadable, environment.writeError);
    return exitCodes.couldNotRun;
  }
  const { program } = loadProject(cwd, found.modules);
  reportDiagnostics(diagnose(program), environment.writeError);
  const compiled = compileTests(program);
  if (compiled.kind !== 'compiled') {
    if (compiled.kind === 'noTests') {
      environment.writeError('ista: no test found.\n');
    }
    return exitCodes.problems;
  }
  const { text } = definitionFormat.write(compiled.definition);
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for await (const report of runTests(text, {
    natives: stdNatives,
    clock: realTime,
    timeout,
    ...(options.filter === undefined ? {} : { filter: options.filter }),
  })) {
    counts[report.outcome.kind] += 1;
    environment.write(reportOf(report));
  }
  environment.write(
    `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped.\n`,
  );
  return counts.failed > 0 || counts.passed + counts.failed === 0
    ? exitCodes.problems
    : exitCodes.clean;
}

/**
 * A test's lines: its mark and title, then a failure's message, trace and the log records its
 * instances committed, indented.
 */
function reportOf({ title, outcome }: TestReport): string {
  const line = `${marks[outcome.kind]} ${title}\n`;
  if (outcome.kind !== 'failed') {
    return line;
  }
  const detail = [
    outcome.message,
    ...outcome.trace.split('\n'),
    ...outcome.logs.map(logLine),
  ].filter((each) => each !== '');
  return `${line}${detail.map((each) => `    ${each}\n`).join('')}`;
}

/** The test modules `paths` name: each file as given, each directory's test modules. */
function testModulesOf(
  cwd: string,
  paths: readonly string[],
): { readonly modules: readonly string[]; readonly unreadable: readonly string[] } {
  const modules: string[] = [];
  const unreadable: string[] = [];
  for (const path of paths) {
    const stats = statSync(resolve(cwd, path), { throwIfNoEntry: false });
    if (stats?.isDirectory() === true) {
      modules.push(...findSources(resolve(cwd, path), testModuleSuffix));
    } else if (stats?.isFile() === true) {
      modules.push(path);
    } else {
      unreadable.push(path);
    }
  }
  return { modules, unreadable };
}
