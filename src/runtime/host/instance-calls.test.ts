/**
 * A host's calls on one instance (§9, instance-calls.ts) run one after another: a call a host's
 * extern makes into the runtime, halfway through the segment calling it, starts once that call
 * ended, and sees what it committed.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { type TestRuntime, testRuntime } from '../runtime.test-kit.ts';
import { snapshotFormat } from '../snapshot/format.ts';

/** A program whose live run `x` spawns `x/1`, which pings its host once its timer is due. */
const pinging = compiledEncoded(
  lines(
    "import * as time from 'time'",
    "import * as runtime from 'runtime'",
    'extern fn ping() -> Int',
    'ista async fn child() -> Int:',
    '  await time.delay(1ms)',
    '  ping()',
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
    'ista async fn _main() -> Int:',
    '  spawn child()',
    '  0',
  ),
);

/** How many commits `tested`'s store took of `instance`. */
function commitsOf(tested: TestRuntime, instance: string): number {
  return tested.store.commits.filter((text) => snapshotFormat.read(text).instance === instance)
    .length;
}

describe("a host's calls on one instance", () => {
  it('run one after another, a call made inside another starting once it ended', async () => {
    const events: string[] = [];
    let inner: Promise<unknown> | undefined;
    const test: TestRuntime = testRuntime({
      externs: {
        'main.ping()': () => {
          events.push('ping');
          inner ??= test.runtime
            .wake('x/1')
            .then(({ state }) => events.push(`inner ${state.kind}`));
          return 1n;
        },
      },
    });
    await test.runtime.deploy(pinging).start('x');
    test.clock.set(1n);
    const outer = await test.runtime.wake('x/1');
    events.push(`outer ${outer.state.kind}`);
    await inner;
    expect(events).toEqual(['ping', 'outer finished', 'inner finished']);
    expect(commitsOf(test, 'x/1')).toBe(2);
  });
});
