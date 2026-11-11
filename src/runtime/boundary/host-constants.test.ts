/**
 * The host's constants where they don't fit (§3.6, §9): an extern constant of the wrong type panics
 * the instance that reads it.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostExterns } from './host-natives.ts';

const program = compiledText(
  [
    'extern limit: Int',
    'ista async fn readLimit() -> Int: limit',
    "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0",
    '# Roots the ista entry a test starts by name: only code a live start reaches is kept.',
    'live async fn reach() -> Int: await runtime.run(runtime.id()) readLimit()',
  ].join('\n'),
);

function hostOf(limit: unknown): HostExterns {
  return { 'main.limit': () => limit };
}

describe('host constants at the boundary', () => {
  it('panics the instance when an extern constant is not of its declared type', () => {
    const test = testRuntime({ host: hostOf('not an int') });
    const started = test.startInstance(program, 'c', { function: 'main.readLimit' });
    expect(started.state).toMatchObject({ kind: 'panicked' });
  });

  it('gives the instance an extern constant of its declared type', async () => {
    const test = testRuntime({ host: hostOf(3) });
    const started = test.startInstance(program, 'e', { function: 'main.readLimit' });
    expect(await runToEnd(test, 'e', started)).toEqual({ kind: 'finished', outcome: 3n });
  });
});
