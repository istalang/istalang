/**
 * What the toolchain knows by name of tests (§10): the testing module's functions it calls or
 * checks, and how a test module's file is named.
 */

/**
 * The testing module's functions the toolchain calls or checks (§10): the runner's listing and
 * running of a suite's tests, `mock`, whose target must name a function, and `handle`, whose type
 * must be an extern type.
 */
export const testingFunctions = {
  list: '_list',
  run: '_run',
  mock: 'mock',
  handle: 'handle',
} as const;

/** What a test module's file name ends with (§10). */
export const testModuleSuffix = '.test.ista';

/** Whether the file at `path` holds a test module (§10), by its name. */
export function isTestModulePath(path: string): boolean {
  return path.endsWith(testModuleSuffix);
}
