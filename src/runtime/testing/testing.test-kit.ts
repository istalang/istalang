/**
 * Running test programs in memory (§10): a test module's source compiled with the std modules and
 * run by `runTests` on a manual clock, which jumps to each time the run waits until, so a test
 * waiting on a timer takes no real time.
 */

import { stdProgramOf } from '../../compiler/binder/bind.test-kit.ts';
import { compileTests, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { renderDiagnostic } from '../../diagnostics/render.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { runTests, type TestReport } from './run-tests.ts';

export interface ReportsOptions {
  readonly filter?: string;
  /** How long a test may run, in milliseconds of the manual clock. */
  readonly timeout?: bigint;
  /** What the manual clock gives each time it is read, given what it gave before. */
  readonly tick?: (before: bigint) => bigint;
}

/** The reports of running the tests of `source`, a test module importing what it needs. */
export function reportsOf(source: string, options: ReportsOptions = {}): readonly TestReport[] {
  const program = stdProgramOf({ 'main.test.ista': source });
  const compiled = compileTests(program);
  if (compiled.kind !== 'compiled') {
    const problems = [...diagnose(program).values()].flatMap(({ source: text, diagnostics }) =>
      diagnostics.map((diagnostic) => renderDiagnostic(text, diagnostic)),
    );
    throw new Error(`The test module didn't compile (${compiled.kind}):\n${problems.join('\n')}`);
  }
  let clock = 1_000_000n;
  const reports: TestReport[] = [];
  const run = runTests(definitionFormat.write(compiled.definition).text, {
    natives: stdNatives,
    now: () => {
      clock = options.tick?.(clock) ?? clock;
      return clock;
    },
    timeout: options.timeout ?? 5000n,
    ...(options.filter === undefined ? {} : { filter: options.filter }),
  });
  for (let step = run.next(); step.done !== true; step = run.next()) {
    if (typeof step.value === 'bigint') {
      clock = step.value;
    } else {
      reports.push(step.value);
    }
  }
  return reports;
}

/** Each report as its title and how it went, with a failure's message. */
export function outcomesOf(reports: readonly TestReport[]): readonly string[] {
  return reports.map(({ title, outcome }) =>
    outcome.kind === 'failed'
      ? `${title}: failed: ${outcome.message}`
      : `${title}: ${outcome.kind}`,
  );
}

/** A test module: the imports the runner tests' programs use, then `body`. */
export function testModule(body: string): string {
  return [
    "import Suite, Test, test, group, skip, only, assert, assertEq, FakeClock, FakeQueue, mock, calls, handle from 'testing'",
    "import idle, reaches, waitingAt, state from 'testing'",
    "import Decodable from 'json'",
    "import * as testing from 'testing'",
    "import * as time from 'time'",
    "import Time, Duration from 'time'",
    body,
  ].join('\n');
}
