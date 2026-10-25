/**
 * The host API at the boundary (§3.6, §9), on programs the real compiler builds: a host starts any
 * startable function by its key with JSON arguments, fills a future it named with JSON, and reads
 * outcomes as JSON. JSON that doesn't fit refuses the host's call and commits nothing; an extern
 * constant is read once per instance; a `@Waypoint` names where an instance waits.
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
import type { HostCall, HostExterns } from './host-natives.ts';

const program = compiledText(
  [
    'struct Order:',
    '  id: string',
    '  amount: int',
    '',
    'extern fn approval(id: string) -> Future<bool>',
    'extern seed: int',
    '',
    'fn total(orders: Array<Order>, rate: float) -> float:',
    '  let sum = 0.0',
    '  for order in orders:',
    '    sum += float(order.amount) * rate',
    '  sum',
    '',
    'async fn decide(order: Order) -> Future<string>:',
    '  const first = seed',
    '  @Waypoint{"approval"}',
    '  const approved = await approval(order.id)',
    '  if approved: order.id + " " + string(first) + "/" + string(seed) else: "no"',
    '',
    'async fn main(): 0',
  ].join('\n'),
);

/** A host whose `approval` hands back a pending future named after the order, and whose seed counts reads. */
function counting(): { readonly host: HostExterns; readonly reads: () => number } {
  let reads = 0;
  return {
    host: {
      'main.approval(string)': ([id], call: HostCall) => call.pending(`approve ${String(id)}`),
      'main.seed': () => {
        reads += 1;
        return reads;
      },
    },
    reads: () => reads,
  };
}

describe('the host API', () => {
  it('lists what a host may start by key, and starts one with JSON arguments', () => {
    const test = testRuntime({ host: counting().host });
    const deployed = test.runtime.deploy(program);
    expect(deployed.starts).toEqual(
      expect.arrayContaining(['main.main()', 'main.total(prelude.Array<main.Order>, float)']),
    );
    const orders = [
      { id: 'a', amount: 2 },
      { id: 'b', amount: 3 },
    ];
    const started = deployed.start('t', {
      function: 'main.total(prelude.Array<main.Order>, float)',
      arguments: [orders, 1.5],
    });
    expect(runToEnd(test, 't', started)).toEqual({ kind: 'finished', outcome: '7.5' });
  });

  it("refuses a start whose JSON doesn't fit, or names no startable function, storing nothing", () => {
    const test = testRuntime({ host: counting().host });
    const deployed = test.runtime.deploy(program);
    const key = 'main.total(prelude.Array<main.Order>, float)';
    expect(() => deployed.start('a', { function: key, arguments: [[{ id: 'a' }], 1] })).toThrow(
      expect.objectContaining({
        reason: 'unfitJson',
        message: expect.stringContaining('amount: missing'),
      }),
    );
    expect(() => deployed.start('b', { function: key, arguments: [[]] })).toThrow(
      expect.objectContaining({ reason: 'notStartable' }),
    );
    expect(() => deployed.start('c', { function: 'main.nothing()' })).toThrow(Refusal);
    expect(test.store.commits).toEqual([]);
  });

  it('fills a named future with JSON, refusing JSON that does not fit and ignoring a token nothing waits on, without committing', () => {
    const { host } = counting();
    const test = testRuntime({ host });
    const deployed = test.runtime.deploy(program);
    const started = deployed.start('d', {
      function: 'main.decide(main.Order)',
      arguments: [{ id: 'o1', amount: 1 }],
    });
    expect(started.state).toEqual({ kind: 'waiting', until: undefined });
    expect(test.runtime.inspect('d').waitingAt.map(({ waypoint }) => waypoint)).toContain(
      'approval',
    );
    const commits = test.store.commits.length;
    expect(() => test.runtime.fill('d', 'approve o1', 'yes')).toThrow(
      expect.objectContaining({ reason: 'unfitJson' }),
    );
    expect(test.store.commits).toHaveLength(commits);
    const ignored = test.runtime.fill('d', 'approve nobody', true);
    expect(ignored.state).toEqual(started.state);
    expect(test.store.commits).toHaveLength(commits);
    const filled = test.runtime.fill('d', 'approve o1', true);
    expect(runToEnd(test, 'd', filled)).toEqual({ kind: 'finished', outcome: '"o1 1/1"' });
  });

  it('reads an extern constant once per instance, keeping it across commits', () => {
    const { host, reads } = counting();
    const test = testRuntime({ host });
    const deployed = test.runtime.deploy(program);
    const order = { id: 'o', amount: 1 };
    deployed.start('first', { function: 'main.decide(main.Order)', arguments: [order] });
    deployed.start('second', { function: 'main.decide(main.Order)', arguments: [order] });
    const first = runToEnd(test, 'first', test.runtime.fill('first', 'approve o', true));
    expect(first).toEqual({ kind: 'finished', outcome: '"o 1/1"' });
    const second = runToEnd(test, 'second', test.runtime.fill('second', 'approve o', true));
    expect(second).toEqual({ kind: 'finished', outcome: '"o 2/2"' });
    expect(reads()).toBe(2);
  });

  it('retries a panicked instance at the time its failed segment started, or terminates it', () => {
    const retried = compiledText(
      [
        "import * as time from 'time'",
        'extern fn ready() -> bool',
        'async fn main() -> Future<int>:',
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
    const deployed = test.runtime.deploy(retried);
    expect(deployed.start('r').state).toMatchObject({ kind: 'panicked', message: 'not ready' });
    test.clock.set(9n);
    expect(runToEnd(test, 'r', test.runtime.retry('r'))).toEqual({
      kind: 'finished',
      outcome: '5',
    });
    expect(() => test.runtime.retry('r')).toThrow(
      expect.objectContaining({ reason: 'notPanicked' }),
    );
    calls = 0;
    deployed.start('t');
    expect(() => test.runtime.fill('t', 'any', true)).toThrow(
      expect.objectContaining({ reason: 'panicked' }),
    );
    expect(test.runtime.terminate('t').state).toEqual({ kind: 'terminated' });
    expect(test.runtime.wake('t').state).toEqual({ kind: 'terminated' });
    expect(test.runtime.fill('t', 'any', true).state).toEqual({ kind: 'terminated' });
    expect(() => test.runtime.terminate('t')).toThrow(Refusal);
  });

  it("keeps a spawned instance's name the runtime's, and its call the committing run's", () => {
    const spawning = compiledText(
      [
        'extern fn pick() -> int',
        'fn child(n: int) -> int: n',
        'async fn main() -> Future<int>:',
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
    const first = testRuntime({ store: crashingOnce, host }).runtime.deploy(spawning);
    expect(() => first.start('a/1')).toThrow(expect.objectContaining({ reason: 'reservedName' }));
    expect(() => first.start('p')).toThrow('crash');
    const test = testRuntime({ store: inner, host });
    const started = test.runtime.deploy(spawning).start('p');
    expect(settleAll(test, 'p', started).get('p/1')).toEqual({ kind: 'finished', outcome: 2n });
  });

  it('refuses a deploy that declares an extern its host already provides with another type', () => {
    const declaring = (type: string) =>
      compiledText(
        `extern limit: ${type}\nextern fn check(n: int) -> bool\nasync fn main(): limit`,
      );
    const host = { 'main.limit': () => 1, 'main.check(int)': () => true };
    const store = recordingStore();
    testRuntime({ store, host }).runtime.deploy(declaring('int'));
    expect(() => testRuntime({ store, host }).runtime.deploy(declaring('int'))).not.toThrow();
    expect(() => testRuntime({ store, host }).runtime.deploy(declaring('string'))).toThrow(
      expect.objectContaining({
        reason: 'externChanged',
        message: expect.stringContaining('main.limit: string'),
      }),
    );
  });

  it('fills a future once, however many segments the fill runs, crashEveryAwait included', () => {
    const waiting = compiledText(
      [
        "import * as time from 'time'",
        'extern fn approval() -> Future<bool>',
        'async fn main() -> Future<bool>:',
        '  const approved = await approval()',
        '  await time.at(time.now())',
        '  approved',
      ].join('\n'),
    );
    const host = {
      'main.approval()': (_: readonly unknown[], call: HostCall) => call.pending('a'),
    };
    const test = testRuntime({ host });
    test.runtime.deploy(waiting).start('c', { crashEveryAwait: true });
    expect(runToEnd(test, 'c', test.runtime.fill('c', 'a', true))).toEqual({
      kind: 'finished',
      outcome: 'true',
    });
  });

  it('retries a panic in the segment a fill ran, filling the future again', () => {
    const filled = compiledText(
      [
        'extern fn approval() -> Future<bool>',
        'extern fn ready() -> bool',
        'async fn main() -> Future<bool>:',
        '  const approved = await approval()',
        '  if not ready():',
        '    panic("not ready")',
        '  approved',
      ].join('\n'),
    );
    let calls = 0;
    const ready = () => {
      calls += 1;
      return calls > 1;
    };
    const host = {
      'main.approval()': (_: readonly unknown[], call: HostCall) => call.pending('a'),
      'main.ready()': ready,
    };
    const test = testRuntime({ host });
    test.runtime.deploy(filled).start('r');
    expect(test.runtime.fill('r', 'a', true).state).toMatchObject({ kind: 'panicked' });
    expect(runToEnd(test, 'r', test.runtime.retry('r'))).toEqual({
      kind: 'finished',
      outcome: 'true',
    });
  });

  it('refuses a host implementing an extern the runtime implements itself, such as the clock', () => {
    expect(() => testRuntime({ host: { 'time.now()': () => 0 } })).toThrow(Refusal);
  });

  it('gives a host every int as a bigint, and takes back a bigint or a whole number for one', () => {
    const given: unknown[] = [];
    const host: HostExterns = {
      'main.echo(int, float)': ([count, rate]) => {
        given.push(count, rate);
        return [count, 2];
      },
    };
    const echoing = compiledText(
      [
        'extern fn echo(count: int, rate: float) -> Array<int>',
        'async fn main() -> Future<Array<int>>: echo(12345678901234567890, 1.5)',
      ].join('\n'),
    );
    const test = testRuntime({ host });
    const started = test.runtime.deploy(echoing).start('e');
    expect(runToEnd(test, 'e', started)).toEqual({
      kind: 'finished',
      outcome: '[12345678901234567890,2]',
    });
    expect(given).toEqual([12345678901234567890n, 1.5]);
  });
});
