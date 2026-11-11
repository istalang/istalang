/**
 * The host's fills and constants where they don't fit (§3.6, §9): a fill of a future disposed with
 * its holder, or of one whose instance ended, changes nothing; an extern constant of the wrong type
 * panics the instance that reads it.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostCall, HostExterns } from './host-natives.ts';

const program = compiledText(
  [
    'extern ista fn slow(name: String) -> Future<Int, "ista">',
    'extern ista fn gate() -> Future<Int, "ista">',
    'extern limit: Int',
    '',
    'ista async fn dropped() -> Int:',
    '  const abandoned = slow("a")',
    '  drop abandoned',
    '  await gate()',
    '',
    'ista async fn readLimit() -> Int: limit',
    '',
    'ista async fn twice() -> Int:',
    '  const first = slow("a")',
    '  await gate() + await first',
    '',
    "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0",
    '',
    '# Roots the ista entries a test starts by name: only code a live start reaches is kept.',
    'live async fn reach():',
    '  _ = await runtime.run(runtime.id()) dropped()',
    '  _ = await runtime.run(runtime.id()) readLimit()',
    '  _ = await runtime.run(runtime.id()) twice()',
    '  0',
  ].join('\n'),
);

function hostOf(overrides: HostExterns = {}): HostExterns {
  return {
    'main.slow(String)': ([name], call: HostCall) => call.pending(`slow ${String(name)}`),
    'main.gate()': (_args, call: HostCall) => call.pending('gate'),
    'main.limit': () => 'not an int',
    ...overrides,
  };
}

describe('host fills and constants at the boundary', () => {
  it('ignores a fill of a future that was disposed, leaving the instance waiting on its own', async () => {
    const test = testRuntime({ host: hostOf() });
    const started = test.startInstance(program, 'd', { function: 'main.dropped' });
    expect(started.state).toMatchObject({ kind: 'waiting' });
    const ignored = await test.runtime.fill('d', 'slow a', 1);
    expect(ignored.state).toMatchObject({ kind: 'waiting' });
    const filled = await test.runtime.fill('d', 'gate', 7);
    expect(await runToEnd(test, 'd', filled)).toEqual({ kind: 'finished', outcome: 7n });
  });

  it('panics the instance when an extern constant is not of its declared type', () => {
    const test = testRuntime({ host: hostOf() });
    const started = test.startInstance(program, 'c', { function: 'main.readLimit' });
    expect(started.state).toMatchObject({ kind: 'panicked' });
  });

  it('panics the instance when the host names a future as one it has yet to fill', () => {
    const test = testRuntime({
      host: hostOf({ 'main.gate()': (_, call: HostCall) => call.pending('slow a') }),
    });
    const started = test.startInstance(program, 't', { function: 'main.twice' });
    expect(started.state).toMatchObject({ kind: 'panicked' });
  });

  it('ignores a fill after the instance ended', async () => {
    const test = testRuntime({ host: hostOf({ 'main.limit': () => 3 }) });
    const started = test.startInstance(program, 'e', { function: 'main.readLimit' });
    expect(await runToEnd(test, 'e', started)).toEqual({ kind: 'finished', outcome: 3n });
    expect((await test.runtime.fill('e', 'gate', 1)).state).toMatchObject({ kind: 'finished' });
  });
});
