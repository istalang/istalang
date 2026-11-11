/**
 * The host API at the boundary (§3.6, §9), on programs the real compiler builds: a host starts any
 * startable function by its key with JSON arguments and reads outcomes as JSON. JSON that doesn't
 * fit refuses the host's call and commits nothing; an extern constant is read once per instance; a
 * `@Waypoint` names where an instance waits.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { Refusal } from '../refusal.ts';
import {
  type RecordingStore,
  recordingStore,
  runToEnd,
  settleAll,
  testRuntime,
} from '../runtime.test-kit.ts';
import type { HostExterns } from './host-natives.ts';

const program = compiledText(
  [
    'struct Order:',
    '  id: String',
    '  amount: Int',
    '',
    'extern seed: Int',
    '',
    'fn total(orders: Array<Order>, rate: Float) -> Float:',
    '  let sum = 0.0',
    '  for order in orders:',
    '    sum += Float(order.amount) * rate',
    '  sum',
    '',
    'ista async fn decide(order: Order) -> String:',
    '  const first = seed',
    '  @Waypoint{"approval"}',
    '  await time.delay(1s)',
    '  order.id + " " + String(first) + "/" + String(seed)',
    '',
    'ista async fn decideFor(id: String) -> String: await decide(Order{id, amount: 1})',
    'ista async fn decideO1() -> String: await decideFor("o1")',
    'ista async fn decideO() -> String: await decideFor("o")',
    '',
    "import * as time from 'time'\nimport * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0",
    '',
    '# Roots the ista entries a test starts by name: only code a live start reaches is kept.',
    'live async fn reach():',
    '  _ = await runtime.run(runtime.id()) decideO1()',
    '  _ = await runtime.run(runtime.id()) decideO()',
    '  0',
  ].join('\n'),
);

/** A host whose seed counts its reads. */
function counting(): { readonly host: HostExterns; readonly reads: () => number } {
  let reads = 0;
  return {
    host: {
      'main.seed': () => {
        reads += 1;
        return reads;
      },
    },
    reads: () => reads,
  };
}

describe('the host API', () => {
  it('lists what a host may start by key, and starts one with JSON arguments', async () => {
    const test = testRuntime({ host: counting().host });
    const deployed = test.runtime.deploy(program);
    expect(deployed.starts).toEqual(
      expect.arrayContaining(['main.main()', 'main.total(prelude.Array<main.Order>, Float)']),
    );
    const orders = [
      { id: 'a', amount: 2 },
      { id: 'b', amount: 3 },
    ];
    const started = await deployed.start('t', {
      function: 'main.total(prelude.Array<main.Order>, Float)',
      arguments: [orders, 1.5],
    });
    expect(await runToEnd(test, 't', started)).toEqual({ kind: 'finished', outcome: '7.5' });
  });

  it("refuses a start whose JSON doesn't fit, or names no startable function, storing nothing", async () => {
    const test = testRuntime({ host: counting().host });
    const deployed = test.runtime.deploy(program);
    const key = 'main.total(prelude.Array<main.Order>, Float)';
    await expect(
      deployed.start('a', { function: key, arguments: [[{ id: 'a' }], 1] }),
    ).rejects.toThrow(
      expect.objectContaining({
        reason: 'unfitJson',
        message: expect.stringContaining('amount: missing'),
      }),
    );
    await expect(deployed.start('b', { function: key, arguments: [[]] })).rejects.toThrow(
      expect.objectContaining({ reason: 'notStartable' }),
    );
    await expect(deployed.start('c', { function: 'main.nothing()' })).rejects.toThrow(Refusal);
    expect(test.store.commits).toEqual([]);
  });

  it('reads an extern constant once per instance, keeping it across commits', async () => {
    const { host, reads } = counting();
    const test = testRuntime({ host });
    const request = { function: 'main.decideO' };
    const started = test.startInstance(program, 'first', request);
    expect(test.runtime.inspect('first').waitingAt.map(({ waypoint }) => waypoint)).toContain(
      'approval',
    );
    expect(await runToEnd(test, 'first', started)).toEqual({ kind: 'finished', outcome: 'o 1/1' });
    const second = test.startInstance(program, 'second', request);
    expect(await runToEnd(test, 'second', second)).toEqual({ kind: 'finished', outcome: 'o 2/2' });
    expect(reads()).toBe(2);
  });

  it('retries a panicked instance at the time its failed segment started, or terminates it', async () => {
    const retried = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'extern fn ready() -> Bool',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  if not ready():',
        '    panic("not ready")',
        '  time.now().value',
      ].join('\n'),
    );
    let calls = 0;
    const ready = () => {
      calls += 1;
      return calls > 1;
    };
    const test = testRuntime({ host: { 'main.ready()': ready } });
    test.clock.set(5n);
    expect(test.startInstance(retried, 'r').state).toMatchObject({
      kind: 'panicked',
      message: 'not ready',
    });
    test.clock.set(9n);
    expect(await runToEnd(test, 'r', await test.runtime.retry('r'))).toEqual({
      kind: 'finished',
      outcome: 5n,
    });
    await expect(test.runtime.retry('r')).rejects.toThrow(
      expect.objectContaining({ reason: 'notPanicked' }),
    );
    calls = 0;
    test.startInstance(retried, 't');
    expect((await test.runtime.terminate('t')).state).toMatchObject({
      kind: 'terminated',
      message: 'not ready',
    });
    expect((await test.runtime.wake('t')).state).toMatchObject({ kind: 'terminated' });
    await expect(test.runtime.terminate('t')).rejects.toThrow(Refusal);
  });

  it("keeps a spawned instance's name the runtime's, and its call the committing run's", async () => {
    const spawning = compiledText(
      [
        'extern fn pick() -> Int',
        'fn child(n: Int) -> Int: n',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  spawn child(pick())',
        '  0',
      ].join('\n'),
    );
    let picks = 0;
    const pick = () => {
      picks += 1;
      return picks;
    };
    const inner = recordingStore();
    let crashed = false;
    const crashingOnce: RecordingStore = {
      ...inner,
      writeSnapshot: (instance, text) => {
        if (instance === 'p' && !crashed) {
          crashed = true;
          throw new Error('crash');
        }
        inner.writeSnapshot(instance, text);
      },
    };
    const host = { 'main.pick()': pick };
    const first = testRuntime({ store: crashingOnce, host });
    expect(() => first.startInstance(spawning, 'p')).toThrow('crash');
    const test = testRuntime({ store: inner, host });
    const started = test.startInstance(spawning, 'p');
    expect((await settleAll(test, 'p', started)).get('p/1')).toMatchObject({
      kind: 'finished',
      outcome: 2n,
    });
  });

  it('refuses a deploy that declares an extern its host already provides with another type', () => {
    const declaring = (type: string) =>
      compiledText(
        `extern limit: ${type}\nextern fn check(n: Int) -> Bool\nimport * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main(): limit`,
      );
    const host = { 'main.limit': () => 1, 'main.check(Int)': () => true };
    const store = recordingStore();
    testRuntime({ store, host }).runtime.deploy(declaring('Int'));
    expect(() => testRuntime({ store, host }).runtime.deploy(declaring('Int'))).not.toThrow();
    expect(() => testRuntime({ store, host }).runtime.deploy(declaring('String'))).toThrow(
      expect.objectContaining({
        reason: 'externChanged',
        message: expect.stringContaining('main.limit: String'),
      }),
    );
  });

  it('refuses a host implementing an extern the runtime implements itself, such as the clock', () => {
    expect(() => testRuntime({ host: { 'time.now()': () => 0 } })).toThrow(Refusal);
  });

  it('gives a host every int as a bigint, and takes back a bigint or a whole number for one', async () => {
    const given: unknown[] = [];
    const host: HostExterns = {
      'main.echo(Int, Float)': ([count, rate]) => {
        given.push(count, rate);
        return [count, 2];
      },
    };
    const echoing = compiledText(
      [
        'extern fn echo(count: Int, rate: Float) -> Array<Int>',
        "import * as runtime from 'runtime'\nlive async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Array<Int>: echo(12345678901234567890, 1.5)",
      ].join('\n'),
    );
    const test = testRuntime({ host });
    const started = await test.runtime.deploy(echoing).start('e');
    expect(await runToEnd(test, 'e', started)).toEqual({
      kind: 'finished',
      outcome: '[12345678901234567890,2]',
    });
    expect(given).toEqual([12345678901234567890n, 1.5]);
  });
});
