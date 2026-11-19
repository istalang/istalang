/**
 * Contexts' host steps (§17.1): a context commits while the live run calling it waits in memory; one
 * stopped mid-invocation resumes at its store's next open, at once where its timer is due; disposing
 * a `Runtime` stops its work until the next open; a `Call` let go of unawaited still starts; what a
 * call still waiting holds is disposed as its instance finishes; a panic no call hears reaches the
 * host; and a key names no spawned instance. What a scenario shows of contexts is in the goldens (test/golden/golden.md).
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import type { EncodedDefinition } from '../../definition/definition.ts';
import type { Value } from '../../definition/values/values.ts';
import { unreachable } from '../../foundation/structures/unreachable.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { ManualClock } from '../clock.ts';
import type { InvocationEnd } from '../run/instances.ts';
import { Future } from '../run/objects/future.ts';
import {
  type RecordingStore,
  recordingStore,
  startToEnd,
  testRuntime,
  testSeed,
} from '../runtime.test-kit.ts';
import { type InstanceStore, memoryStore } from '../store.ts';
import { DurableWorld } from './durable-world.ts';
import { worldProgram } from './programs.ts';
import { runUntil } from './world-driving.ts';

const header = [
  "import * as runtime from 'runtime'",
  "import * as time from 'time'",
  'struct Order:',
  '  id: String',
  '  amount: Int',
  'ista async fn purchase(order: Order) -> Int:',
  '  await time.delay(1s)',
  '  await runtime.commit()',
  '  order.amount * 2',
];

/** A program whose live `main` runs `body` after opening a runtime `rt` over the host's store. */
function opening(...body: readonly string[]): EncodedDefinition {
  return compiledEncoded(
    lines(
      ...header,
      'live async fn main() -> Int:',
      '  const rt = await runtime.Runtime.open(runtime.hostStore())',
      ...body,
    ),
  );
}

/** `main` calling `purchase` in the context "o1", giving what it gave or `-1`. */
const purchase = opening(
  '  match await rt.call("o1") purchase(Order{id: "o1", amount: 21}):',
  '    case Ok(value): value',
  '    case Err(_): -1',
);

/** A store over `inner` whose writes after the first stop the process, as a crash does. */
function stoppingAfterFirstWrite(inner: InstanceStore): RecordingStore {
  let writes = 0;
  return recordingStore({
    ...inner,
    writeSnapshot: (instance, text) => {
      writes += 1;
      if (writes > 1) {
        throw new Error('the process stops');
      }
      inner.writeSnapshot(instance, text);
    },
  });
}

describe('a context', () => {
  it('commits to the store while the live run waits in memory, which never reaches it', async () => {
    const test = testRuntime();
    await startToEnd(test, purchase);
    expect(test.store.commits.length).toBeGreaterThan(1);
    expect(test.store.readSnapshot('test')).toBeUndefined();
    expect(test.runtime.inspect('o1').state).toMatchObject({ kind: 'waiting', until: undefined });
  });

  it('stopped mid-invocation, resumes at the next open of its store', async () => {
    const inner = memoryStore();
    const stopped = testRuntime({ store: stoppingAfterFirstWrite(inner) });
    await expect(startToEnd(stopped, purchase)).rejects.toThrow('the process stops');
    expect(stopped.runtime.inspect('o1').state).toMatchObject({ kind: 'waiting', until: 1000n });

    const next = testRuntime({ store: recordingStore(inner) });
    const waitingAnHour = opening('  await time.delay(1h)', '  0');
    expect(await startToEnd(next, waitingAnHour)).toEqual({ kind: 'finished', outcome: '0' });
    expect(next.runtime.inspect('o1').state).toMatchObject({ kind: 'waiting', until: undefined });
  });

  it('resumes at once where its timer is due as Runtime.open awaits, with no other live wait', async () => {
    const inner = memoryStore();
    const stopped = testRuntime({ store: stoppingAfterFirstWrite(inner) });
    await expect(startToEnd(stopped, purchase)).rejects.toThrow('the process stops');

    const next = testRuntime({ store: recordingStore(inner) });
    next.clock.set(2000n);
    expect(await startToEnd(next, opening('  0'))).toEqual({ kind: 'finished', outcome: '0' });
    expect(next.runtime.inspect('o1').state).toEqual({
      kind: 'waiting',
      until: undefined,
      watching: [],
    });
  });

  it('stops its work once its Runtime is disposed, until the next Runtime.open resumes it', async () => {
    const disposing = opening(
      '  drop rt.call("o1") purchase(Order{id: "o1", amount: 21})',
      '  await time.delay(100ms)',
      '  drop rt',
      '  await time.delay(2s)',
      '  0',
    );
    const test = testRuntime();
    expect(await startToEnd(test, disposing)).toEqual({ kind: 'finished', outcome: '0' });
    expect(test.runtime.inspect('o1').state).toEqual({
      kind: 'waiting',
      until: 1000n,
      watching: [],
    });
  });

  it('starts an invocation when its Call is let go of unawaited', async () => {
    const unawaited = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        "import * as log from 'log'",
        'ista fn touch() -> Int:',
        '  log.info("touched")',
        '  1',
        'live async fn main() -> Int:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop rt.call("o1") touch()',
        '  0',
      ),
    );
    const logged: string[] = [];
    const test = testRuntime({
      reports: {
        logs: (records) => logged.push(...records.map(({ message }) => message)),
        panicked: () => undefined,
      },
    });
    expect(await startToEnd(test, unawaited)).toEqual({ kind: 'finished', outcome: '0' });
    expect(logged).toEqual(['touched']);
    expect(test.runtime.inspect('o1').state).toEqual({
      kind: 'waiting',
      until: undefined,
      watching: [],
    });
  });

  it('disposes what a call still waiting holds as its instance finishes, before its constants', async () => {
    // Program code calls contexts alone, by key (§17.1); the loop serving jobs calls into any instance
    // by its name, a spawned one's too, as the world is driven here.
    const program = worldProgram(
      compiledEncoded(
        lines(
          "import * as runtime from 'runtime'",
          "import * as time from 'time'",
          "import * as log from 'log'",
          'shared struct Lease { name: String }',
          'fn dispose(self: Lease): log.info("disposed " + self->name)',
          'ista const lease = new Lease{name: "constant"}',
          'ista async fn child() -> Int:',
          '  _ = lease',
          '  await time.delay(10ms)',
          '  1',
          'ista fn cleanup(): log.info("query cleaned up")',
          'ista async fn slowQuery() -> Int:',
          '  hold _ = defer cleanup()',
          '  await time.delay(1s)',
          '  2',
          'ista async fn spawner():',
          '  drop spawn child()',
          'live async fn main() -> Int:',
          '  await runtime.run("o1") spawner()',
          '  await runtime.run("o1") slowQuery()',
        ),
      ),
    );
    const logged: string[] = [];
    const world = new DurableWorld(
      {
        natives: stdNatives,
        clock: new ManualClock(),
        seed: testSeed,
        store: memoryStore(),
        reports: {
          logs: (records) => logged.push(...records.map(({ message }) => message)),
          panicked: () => undefined,
        },
      },
      () => program,
    );
    const host = world.liveRun(program, 'host', () => undefined);
    // An open runtime has the world run the store's work: its instances' timers.
    world.open(host, new Future(host.newId()), () => null);
    const invoked = async (instance: string, entry: string): Promise<InvocationEnd> => {
      const function_ = program.definition.functions.findIndex(({ name }) => name === entry);
      const closure: Value = { kind: 'closure', function: function_, captures: [] };
      let ended: InvocationEnd | undefined;
      world.invokeIn(host, instance, { closure, passed: [], hears: () => true }, (end) => {
        ended = end;
      });
      await runUntil(world, () => ended !== undefined);
      return ended ?? unreachable(`The call into ${instance} never ended.`);
    };
    await invoked('o1', 'main.spawner');
    expect(await invoked('o1/1', 'main.slowQuery')).toEqual({
      kind: 'unanswered',
      instance: 'o1/1',
    });
    expect(logged).toEqual(['query cleaned up', 'disposed constant']);
  });

  it("tells the host of a context's panic that only a call let go of was waiting on", async () => {
    const dropped = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'ista async fn bad() -> Int:',
        '  await time.delay(5ms)',
        '  panic("bad")',
        'live async fn main() -> Int:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop rt.call("o1") bad()',
        '  await time.delay(20ms)',
        '  0',
      ),
    );
    const panicked: string[] = [];
    const test = testRuntime({
      reports: {
        logs: () => undefined,
        panicked: (instance, { message }) => panicked.push(`${instance}: ${message}`),
      },
    });
    expect(await startToEnd(test, dropped)).toEqual({ kind: 'finished', outcome: '0' });
    expect(panicked).toEqual(['o1: bad']);
  });
});

describe("a context's key", () => {
  it("can't name an instance a context spawned: it holds no '/', which spawned names take (§17.1)", async () => {
    const program = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'ista async fn waiting() -> Int:',
        '  await time.delay(1h)',
        '  0',
        'ista fn spawning() -> Instance<Int>: spawn waiting()',
        'ista fn named() -> String: runtime.id()',
        'live async fn main() -> String:',
        '  _ = await runtime.run("x") spawning()',
        '  await runtime.run("x/1") named()',
      ),
    );
    expect(await startToEnd(testRuntime(), program)).toMatchObject({
      kind: 'panicked',
      message: "A context's key 'x/1' holds a '/', which only spawned instances' names do (§17.1).",
    });
  });
});
