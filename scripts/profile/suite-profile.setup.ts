/**
 * Profiles every test file of a vitest run, one CPU profile each, into `.vitest/profiles/` (named
 * after the file's path, `/` written `__`), which analyze.ts reads and merges by glob: where a
 * suite's CPU goes, by file and by phase. It is a setup file (suite-profile.config.ts), so it runs
 * in the worker before the test file is imported, and its profile holds the file's imports and
 * top-level work too.
 *
 * A worker's own `--cpu-prof` writes nothing, since vitest ends its workers rather than letting
 * them exit; the profile is taken over the inspector instead, and written after the file's tests.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { relative, resolve } from 'node:path';
import { afterAll, expect } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const profiles = resolve(repoRoot, '.vitest/profiles');
const samplingIntervalUs = 500;

const session = new Session();
session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: samplingIntervalUs });
await session.post('Profiler.start');

afterAll(async () => {
  const { profile } = await session.post('Profiler.stop');
  // biome-ignore lint/suspicious/noMisplacedAssertion: no assertion; a setup file learns its test file's path only from the runner's state.
  const name = relative(repoRoot, expect.getState().testPath ?? 'unknown').replaceAll('/', '__');
  mkdirSync(profiles, { recursive: true });
  writeFileSync(resolve(profiles, `${name}.cpuprofile`), JSON.stringify(profile));
});
