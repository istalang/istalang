/**
 * Running a test Definition's suites (§10): each suite's tests are listed in an instance of their
 * own, then each test that runs gets a fresh world (world/), so nothing one test leaves behind
 * reaches the next.
 *
 * - A suite function is a function value, which can't cross to a new instance, so every instance
 *   calls it afresh: the listing, and each test's own, which runs the test at its position once it
 *   finds the listed title still there (testing.ista `_list`, `_run`).
 * - When any listed test is focused with `only`, the others are skipped; a filter leaves out every
 *   test whose full title lacks its text, without reporting it.
 * - A suite whose listing fails is reported as one failed test, titled by the suite.
 * - Each test's random values come from a seed made from its full title, so a run repeats them
 *   (§10).
 * - Each test may wait on timers; the generator yields every such wait, as `World.run` does, for
 *   the caller to make, and reports each test as it ends.
 */

import { createHash } from 'node:crypto';
import { type Definition, definitionFormat } from '../../definition/definition.ts';
import { listingArguments, runningArguments } from '../../definition/tables/test-runner.ts';
import { fieldValueOf } from '../../definition/values/declared-values.ts';
import { elementsOf, type Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import type { Natives } from '../natives.ts';
import { seedFrom } from '../snapshot/random.ts';
import type { InstanceCall } from '../snapshot/snapshot.ts';
import { type Ended, type Failed, World } from './world/index.ts';

export interface TestRunOptions {
  readonly natives: Natives;
  /** Milliseconds since the Unix epoch. */
  readonly now: () => bigint;
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

/**
 * Runs `call` as the instance of the test or listing titled `title`, in a world of its own: yields
 * each wait, returns its end.
 */
type RunInWorld = (call: InstanceCall, title: string) => Generator<bigint, Ended, undefined>;

/**
 * Runs the tests of the Definition `text`, yielding each wait until a time and each report; the
 * Definition must be one built to run tests.
 */
export function* runTests(
  text: string,
  options: TestRunOptions,
): Generator<bigint | TestReport, void, undefined> {
  const { value: definition, hash } = definitionFormat.readCanonical(text);
  const tests = definition.tests ?? unreachable('This Definition was not built to run tests.');
  const run: RunInWorld = function* (call, title) {
    const deadline = options.now() + options.timeout;
    const seed = seedFrom(createHash('sha256').update(title).digest());
    return yield* new World({ ...options, definition, hash, seed, deadline }).run(call);
  };
  const listings: Listing[] = [];
  for (const { title, function: suite } of tests.suites) {
    const listing = yield* run(callOf(tests.list, listingArguments(suite, title)), title);
    if (listing.kind === 'failed') {
      yield { title, outcome: listing };
    } else {
      listings.push({ suite, title, listed: listedOf(definition, listing.outcome) });
    }
  }
  const focused = listings.some(({ listed }) => listed.some(({ only }) => only));
  for (const listing of listings) {
    yield* runListed(listing, { run, runner: tests.run, focused, filter: options.filter });
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
function* runListed(
  { suite, title, listed }: Listing,
  { run, runner, focused, filter }: ListedRun,
): Generator<bigint | TestReport, void, undefined> {
  for (const [position, test] of listed.entries()) {
    if (filter === undefined || test.title.includes(filter)) {
      if (test.skipped || (focused && !test.only)) {
        yield { title: test.title, outcome: { kind: 'skipped' } };
      } else {
        const ended = yield* run(
          callOf(runner, runningArguments({ suite, title, position, expected: test.title })),
          test.title,
        );
        yield { title: test.title, outcome: ended.kind === 'failed' ? ended : { kind: 'passed' } };
      }
    }
  }
}

/** A call of `function_` with `arguments_`, as an instance starts with. */
function callOf(function_: number, arguments_: readonly Value[]): InstanceCall {
  return { function: function_, captures: [], arguments: [...arguments_] };
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
