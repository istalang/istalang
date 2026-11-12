/**
 * Running test programs in memory (§10): a test module's source compiled with the std modules and
 * run by `runTests` on a manual clock, which jumps to each time the run waits until, so a test
 * waiting on a timer takes no real time.
 */

import { stdProgramOf } from '../../compiler/binder/bind.test-kit.ts';
import { compileTests, diagnose } from '../../compiler/compile.ts';
import { definitionFormat } from '../../definition/definition.ts';
import { renderDiagnostics } from '../../foundation/diagnostics/render.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { ManualClock } from '../clock.ts';
import { oracle } from '../lifetimes/oracle.test-kit.ts';
import type { HeapCheck } from '../scheduler/loaded-definition.ts';
import { runTests, type TestReport } from './run-tests.ts';

export interface ReportsOptions {
  readonly filter?: string;
  /** How long a test may run, in milliseconds of the manual clock. */
  readonly timeout?: bigint;
  /** What the manual clock gives each time it is read, given what it gave before. */
  readonly tick?: (before: bigint) => bigint;
  /** The check of every instance's heap, the oracle of static lifetimes unless told otherwise. */
  readonly heapCheck?: HeapCheck;
}

/** The reports of running the tests of `source`, a test module importing what it needs. */
export async function reportsOf(
  source: string,
  options: ReportsOptions = {},
): Promise<readonly TestReport[]> {
  const program = stdProgramOf({ 'main.test.ista': source });
  const compiled = compileTests(program);
  if (compiled.kind !== 'compiled') {
    const problems = renderDiagnostics(diagnose(program));
    throw new Error(`The test module didn't compile (${compiled.kind}):\n${problems.join('\n')}`);
  }
  const clock = new ManualClock(1_000_000n);
  const { tick } = options;
  const reports: TestReport[] = [];
  for await (const report of runTests(definitionFormat.write(compiled.definition).text, {
    natives: stdNatives,
    clock: {
      now: () => {
        if (tick !== undefined) {
          clock.set(tick(clock.now()));
        }
        return clock.now();
      },
      until: clock.until,
    },
    timeout: options.timeout ?? 5000n,
    heapCheck: options.heapCheck ?? oracle,
    ...(options.filter === undefined ? {} : { filter: options.filter }),
  })) {
    reports.push(report);
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
