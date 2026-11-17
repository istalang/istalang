/**
 * What an instance disposes as it ends (§3.4, §7, §9): the call its outcome awaits when it is
 * terminated, a root's own defers before the outcome it returns, and its context constants, with
 * what they hold, whether the host's or the program's. And how a wait on an instance's end goes on
 * as it ends: on a fresh runtime too, and committed once resolved, before anything awaits it. And
 * that a panic ends its instance where it happens, however deep in calls started within a call.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import type { EncodedDefinition } from '../../definition/definition.ts';
import { ManualClock } from '../clock.ts';
import type { LogRecord } from '../instance-state.ts';
import { recordingStore, startToEnd, testRuntime } from '../runtime.test-kit.ts';

/** The messages of what a step showed. */
const messages = ({ logs }: { readonly logs: readonly LogRecord[] }) =>
  logs.map(({ message }) => message);

/** A test runtime, and the messages its instances logged by instance, as the host hears them. */
function heard() {
  const logged = new Map<string, string[]>();
  const test = testRuntime({
    reports: {
      logs: (records) => {
        for (const { instance, message } of records) {
          logged.set(instance, [...(logged.get(instance) ?? []), message]);
        }
      },
      panicked: () => undefined,
    },
  });
  return { test, logged };
}

const leases = [
  "import * as log from 'log'",
  "import * as runtime from 'runtime'",
  'shared struct Lease { name: String }',
  'fn dispose(self: Lease): log.info("disposed " + self->name)',
];

describe('a spawned instance', () => {
  it('disposes the call its outcome awaits as it is terminated, and a disposable outcome as it finishes', async () => {
    const text = compiledEncoded(
      lines(
        "import * as time from 'time'",
        ...leases,
        'ista async fn boomAfterDelay() -> Unit:',
        '  await time.delay(5ms)',
        '  panic("boom")',
        'ista async fn worker() -> Int:',
        '  hold _ = boomAfterDelay()',
        '  await select:',
        '    case time.delay(100s): 0',
        '    case worker.disposing():',
        '      log.info("worker graceful cleanup")',
        '      1',
        'ista async fn makesLease() -> Lease:',
        '  await time.delay(5ms)',
        '  new Lease{name: "awaited"}',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  drop spawn worker()',
        '  drop spawn makesLease()',
        '  0',
      ),
    );
    const test = testRuntime();
    await startToEnd(test, text, { instance: 'p' });
    test.clock.set(test.clock.now() + 5n);
    await test.runtime.wake('p/1');
    expect(messages(await test.runtime.terminate('p/1'))).toEqual(['worker graceful cleanup']);
    expect(messages(await test.runtime.wake('p/2'))).toEqual(['disposed awaited']);
  });

  it("disposes its root's own defers before the outcome the root returns, spawned as a call or as a function value", async () => {
    const text = compiledEncoded(
      lines(
        ...leases,
        'ista async fn make() -> Lease:',
        '  _ = defer(fn(): log.info("defer"))',
        '  new Lease{name: "out"}',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  drop spawn make()',
        '  drop spawn(make)',
        '  0',
      ),
    );
    const { test, logged } = heard();
    await startToEnd(test, text, { instance: 'p' });
    expect(logged.get('p/1')).toEqual(['defer', 'disposed out']);
    expect(logged.get('p/2')).toEqual(['defer', 'disposed out']);
  });
  it('is terminated at once when isolated and it panics, keeping its panic (§9 runtime.isolate)', async () => {
    const text = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'ista async fn child(n: Int) -> Int:',
        '  await time.delay(10ms)',
        '  n * 2',
        'fn broken() -> Int: panic("broken")',
        'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> String:',
        '  const doubled = await (spawn child(21)).result()',
        '  const isolated = await runtime.isolate(fn(): broken())',
        '  match (doubled, isolated):',
        '    case (Ok(value), Err(error)): "" + value + " " + error.code + " " + error.message',
        '    case _: "unexpected"',
      ),
    );
    const test = testRuntime();
    expect(await startToEnd(test, text, { instance: 'p' })).toEqual({
      kind: 'finished',
      outcome: '"42 panic broken"',
    });
    expect(test.runtime.inspect('p/2').state).toMatchObject({
      kind: 'terminated',
      message: 'broken',
    });
  });
});

describe("an instance's context constants", () => {
  it('are disposed with what they hold once the instance ends, a host extern lease included', async () => {
    const text = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        'extern shared struct Lease',
        'extern fn makeLease() -> Lease',
        'extern fn dispose(self: Lease)',
        'ista const lease = makeLease()',
        'live async fn main() -> Int:',
        '  _ = await runtime.run("a") _spawnReading()',
        '  await runtime.run("a") _readLater()',
        'ista fn _spawnReading() -> Instance<Int>: spawn _reads()',
        'ista async fn _reads() -> Int:',
        '  _ = lease',
        '  0',
        'ista async fn _readLater() -> Int:',
        '  await runtime.commit()',
        '  0',
      ),
    );
    let disposed = 0;
    const test = testRuntime({
      host: {
        'main.makeLease()': () => 'lease',
        'main.dispose(main.Lease)': () => {
          disposed += 1;
          return null;
        },
      },
    });
    expect(await startToEnd(test, text)).toMatchObject({ kind: 'finished' });
    expect(disposed).toBe(1);
  });

  it.each([
    ['made', 'client', ['finish 5', 'client 5'], 0],
    ['client', 'made', ['finish 5'], -1],
  ])(
    'are read by what their instance disposes as it ends, the last made let go of first (%s read first)',
    async (first, second, recorded, outcome) => {
      const records: string[] = [];
      const test = testRuntime({
        host: {
          'main.record(String)': ([recordText]) => {
            records.push(String(recordText));
            return null;
          },
        },
      });
      const text = compiledEncoded(
        lines(
          "import * as runtime from 'runtime'",
          'shared struct Count:',
          '  value: Int',
          'ista const made = new Count{value: 0}',
          'extern fn record(text: String)',
          'shared struct Client:',
          '  name: String',
          'ista fn dispose(self: Client): record(`${self->name} ${made->value}`)',
          'ista const client = new Client{name: "client"}',
          'ista fn _finish():',
          '  record(`finish ${made->value}`)',
          'ista async fn _reads() -> Int:',
          '  hold _ = defer _finish()',
          `  _ = ${first}`,
          `  _ = ${second}`,
          '  made->value = 5',
          '  0',
          'live async fn main() -> Int:',
          '  const child = await runtime.run("a") _spawned()',
          '  await runtime.run("a") _awaited(child)',
          'ista fn _spawned() -> Instance<Int>: spawn _reads()',
          'ista async fn _awaited(child: Instance<Int>) -> Int:',
          '  match await child.result():',
          '    case Ok(value): value',
          '    case Err(_): -1',
        ),
      );
      expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: `${outcome}` });
      expect(records).toEqual(recorded);
    },
  );
});

/** `body`, spawned as `o/1` by the context `o`, which a live `main` calls and returns from. */
function spawnedFrom(...body: readonly string[]): EncodedDefinition {
  return compiledEncoded(
    lines(
      "import * as time from 'time'",
      "import * as runtime from 'runtime'",
      ...body,
      'ista async fn spawner() -> Int:',
      '  spawn parent()',
      '  0',
      'live async fn main() -> Int: await runtime.run("o") spawner()',
    ),
  );
}

describe("a wait on another instance's end", () => {
  it('wakes the waiting parent on a fresh runtime once its child has ended there', async () => {
    const text = spawnedFrom(
      'ista async fn child(n: Int) -> Int:',
      '  await time.delay(10ms)',
      '  n * 2',
      'ista async fn parent() -> Int:',
      '  match await (spawn child(21)).result():',
      '    case Ok(value): value',
      '    case Err(_): -1',
    );
    const store = recordingStore();
    const clock = new ManualClock();
    const first = testRuntime({ store, clock });
    expect(await startToEnd(first, text)).toEqual({ kind: 'finished', outcome: '0' });
    expect(first.runtime.inspect('o/1').state).toMatchObject({ watching: ['o/1/1'] });

    const restarted = testRuntime({ store, clock });
    clock.set(10n);
    expect((await restarted.runtime.wake('o/1/1')).state).toMatchObject({
      kind: 'finished',
      outcome: 42n,
    });
    expect((await restarted.runtime.wake('o/1')).state).toMatchObject({
      kind: 'finished',
      outcome: 42n,
    });
  });

  it('commits once resolved though nothing awaits it yet, so its instance stops being woken for it', async () => {
    const text = spawnedFrom(
      'fn quick() -> Int: 7',
      'ista async fn parent() -> Int:',
      '  const ending = (spawn quick()).result()',
      '  await time.delay(5ms)',
      '  match await ending:',
      '    case Ok(value): value',
      '    case Err(_): 0',
    );
    const test = testRuntime();
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '0' });
    expect(test.runtime.inspect('o/1/1').state).toMatchObject({ kind: 'finished', outcome: 7n });
    expect(test.runtime.inspect('o/1').state).toEqual({
      kind: 'waiting',
      until: 5n,
      watching: [],
    });
    test.clock.set(5n);
    expect((await test.runtime.wake('o/1')).state).toMatchObject({
      kind: 'finished',
      outcome: 7n,
    });
  });
});

describe('a panic', () => {
  it.each([
    ['a plain', 'ista fn caller() -> Int:'],
    ['an async', 'ista async fn caller() -> Int:'],
  ])(
    'in an async call before its first await ends its instance there: %s caller runs no further (§3.12)',
    async (_, caller) => {
      const records: string[] = [];
      const test = testRuntime({
        host: {
          'main.record(String)': ([recordText]) => {
            records.push(String(recordText));
            return null;
          },
        },
      });
      const text = compiledEncoded(
        lines(
          "import * as runtime from 'runtime'",
          'extern fn record(text: String)',
          'ista async fn boom() -> Int: panic("boom")',
          caller,
          '  drop boom()',
          '  record("after the panic")',
          '  1',
          'live async fn main() -> Int: await runtime.run("c") caller()',
        ),
      );
      expect(await startToEnd(test, text)).toMatchObject({ kind: 'panicked', message: 'boom' });
      expect(records).toEqual([]);
    },
  );
});
