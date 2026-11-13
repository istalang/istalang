/**
 * The calls `ista test` makes of the testing module's runner (testing.ista `_list`, `_run`, §10):
 * one home for their arguments, which the runtime builds and validation/references.ts holds a test
 * Definition's runner entries to. A suite is passed as a closure capturing nothing, since `@Suite`
 * functions are top-level.
 */

import type { FunctionId } from '../operands.ts';
import type { Value } from '../values/values.ts';

/** A test to run: its suite's function and title, and its own position and title in the listing. */
interface ListedTest {
  readonly suite: FunctionId;
  readonly title: string;
  readonly position: number;
  readonly expected: string;
}

/** `_list`'s arguments: the suite and its title. */
export function listingArguments(suite: FunctionId, title: string): readonly [Value, string] {
  return [suiteValue(suite), title];
}

/** `_run`'s arguments: the suite, its title, and the test's position and title. */
export function runningArguments(test: ListedTest): readonly [Value, string, bigint, string] {
  return [suiteValue(test.suite), test.title, BigInt(test.position), test.expected];
}

/** How many arguments each runner function takes, held to its arguments' shape by the compiler. */
export const runnerArity = { list: 2, run: 4 } as const satisfies {
  readonly list: ReturnType<typeof listingArguments>['length'];
  readonly run: ReturnType<typeof runningArguments>['length'];
};

function suiteValue(suite: FunctionId): Value {
  return { kind: 'closure', function: suite, captures: [] };
}
