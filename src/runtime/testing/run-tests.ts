/**
 * Running a test Definition's suites (§10): each suite's tests are listed in a world of their own,
 * then each test that runs gets a fresh world (test-world.ts), so nothing one test leaves behind
 * reaches the next.
 *
 * - A suite function is a function value, which can't cross to a new instance, so every world
 *   calls it afresh: the listing, and each test's own, which runs the test at its position once it
 *   finds the listed title still there (testing.ista `_list`, `_run`).
 * - When any listed test is focused with `only`, the others are skipped; a filter leaves out every
 *   test whose full title lacks its text, without reporting it.
 * - A suite whose listing fails is reported as one failed test, titled by the suite.
 * - Each test's random values come from a seed made from its full title, so a run repeats them.
 * - The program is compiled once, for every world (codegen/emit.ts); an extern the natives lack
 *   is the test's host's (test-host.ts).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { emitProgram } from '../../codegen/emit.ts';
import type { KeyedDefinition } from '../../definition/definition.ts';
import type { Definition } from '../../definition/tables/index.ts';
import { fieldValueOf } from '../../definition/values/declared-values.ts';
import { elementsOf, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Clock } from '../clock.ts';
import type { Natives } from '../natives.ts';
import { unmockedExterns } from './test-host.ts';
import { type Ended, type Failed, runInWorld, type WorldCall } from './test-world.ts';

interface TestRunOptions {
  readonly natives: Natives;
  readonly clock: Clock;
  /** How long one test may run, in milliseconds. */
  readonly timeout: bigint;
  /** Run only the tests whose full title contains this. */
  readonly filter?: string;
}

/** How one test went. */
type TestOutcome = { readonly kind: 'passed' } | { readonly kind: 'skipped' } | Failed;

export interface TestReport {
  /** The suite's, the groups' and the test's titles, joined with ` › `. */
  readonly title: string;
  readonly outcome: TestOutcome;
}

/** A test as its suite's listing gives it. */
interface Listed {
  readonly title: string;
  readonly skipped: boolean;
  readonly only: boolean;
}

/** A suite's tests, as its listing gave them. */
interface Listing {
  readonly suite: number;
  readonly title: string;
  readonly listed: readonly Listed[];
}

/** Runs `call` as the instance of the test or listing titled `title`, in a world of its own. */
type RunInWorld = (call: WorldCall, title: string) => Promise<Ended>;

/**
 * Runs the tests of `keyed`'s Definition, yielding each report; the Definition must be one built
 * to run tests.
 */
export async function* runTests(
  { definition, hash: version }: KeyedDefinition,
  options: TestRunOptions,
): AsyncGenerator<TestReport, void, undefined> {
  const { purpose } = definition;
  if (purpose.kind !== 'tests') {
    unreachable('This Definition was not built to run tests.');
  }
  const program = emitProgram(definition);
  const natives = { ...options.natives, ...unmockedExterns(definition, options.natives) };
  const run: RunInWorld = (call, title) =>
    runInWorld(
      {
        definition,
        program,
        natives,
        version,
        clock: options.clock,
        seed: sha256(utf8ToBytes(title)),
        deadline: options.clock.now() + options.timeout,
      },
      call,
    );
  const listings: Listing[] = [];
  for (const { title, function: suite } of purpose.suites) {
    // biome-ignore lint/performance/noAwaitInLoops: tests run one at a time, each in its own world.
    const listing = await run(
      { function: purpose.list, arguments: [closureOf(suite), title] },
      title,
    );
    if (listing.kind === 'failed') {
      yield { title, outcome: listing };
    } else {
      listings.push({ suite, title, listed: listedOf(definition, listing.outcome) });
    }
  }
  const focused = listings.some(({ listed }) => listed.some(({ only }) => only));
  for (const listing of listings) {
    yield* runListed(listing, { run, runner: purpose.run, focused, filter: options.filter });
  }
}

/** What running a listing's tests needs beyond the listing. */
interface ListedRun {
  readonly run: RunInWorld;
  /** The testing module's code that runs one test (testing.ista `_run`). */
  readonly runner: number;
  /** Whether some test of the run is focused with `only`, which skips every other. */
  readonly focused: boolean;
  readonly filter: string | undefined;
}

/** Runs the tests of `listing` the filter leaves in, skipping those the run skips. */
async function* runListed(
  { suite, title, listed }: Listing,
  { run, runner, focused, filter }: ListedRun,
): AsyncGenerator<TestReport, void, undefined> {
  for (const [position, test] of listed.entries()) {
    if (filter === undefined || test.title.includes(filter)) {
      if (test.skipped || (focused && !test.only)) {
        yield { title: test.title, outcome: { kind: 'skipped' } };
      } else {
        const passed = [closureOf(suite), title, BigInt(position), test.title];
        // biome-ignore lint/performance/noAwaitInLoops: tests run one at a time, each in its own world.
        const ended = await run({ function: runner, arguments: passed }, test.title);
        yield { title: test.title, outcome: ended.kind === 'failed' ? ended : { kind: 'passed' } };
      }
    }
  }
}

/** The suite function `suite` as a value, which a listing and a test's run call. */
function closureOf(suite: number): Value {
  return { kind: 'closure', function: suite, captures: [] };
}

/** The tests a listing gave, each a `Listed` struct read by its field names. */
function listedOf(definition: Definition, outcome: Value): readonly Listed[] {
  return elementsOf(outcome).map((element) => {
    const field = (name: string) => fieldValueOf(definition.types, element, name);
    const title = field('title');
    const skipped = field('skipped');
    const only = field('only');
    if (typeof title !== 'string' || typeof skipped !== 'boolean' || typeof only !== 'boolean') {
      unreachable("A listing's struct lacks a field the runner reads.");
    }
    return { title, skipped, only };
  });
}
