/**
 * Contexts' host steps (§9): a context commits while the live run calling it waits in memory; one
 * stopped mid-invocation resumes at its store's next open, at once where its timer is due; disposing
 * a `Runtime` stops its work until the next open; a `Call` let go of unawaited still starts; what a
 * call still waiting holds is disposed as its instance finishes; and a panic no call hears reaches
 * the host. What a scenario shows of contexts is in the goldens (test/golden/golden.md).
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import type { EncodedDefinition } from '../../definition/definition.ts';
import {
  type RecordingStore,
  recordingStore,
  startToEnd,
  testRuntime,
} from '../runtime.test-kit.ts';
import { type InstanceStore, memoryStore } from '../store.ts';

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

/** `main` calling `purchase` in the context "o/1", giving what it gave or `-1`. */
const purchase = opening(
  '  match await rt.call("o/1") purchase(Order{id: "o/1", amount: 21}):',
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
    expect(test.runtime.inspect('o/1').state).toMatchObject({ kind: 'waiting', until: undefined });
  });

  it('stopped mid-invocation, resumes at the next open of its store', async () => {
    const inner = memoryStore();
    const stopped = testRuntime({ store: stoppingAfterFirstWrite(inner) });
    await expect(startToEnd(stopped, purchase)).rejects.toThrow('the process stops');
    expect(stopped.runtime.inspect('o/1').state).toMatchObject({ kind: 'waiting', until: 1000n });

    const next = testRuntime({ store: recordingStore(inner) });
    const waitingAnHour = opening('  await time.delay(1h)', '  0');
    expect(await startToEnd(next, waitingAnHour)).toEqual({ kind: 'finished', outcome: '0' });
    expect(next.runtime.inspect('o/1').state).toMatchObject({ kind: 'waiting', until: undefined });
  });

  it('resumes at once where its timer is due as Runtime.open awaits, with no other live wait', async () => {
    const inner = memoryStore();
    const stopped = testRuntime({ store: stoppingAfterFirstWrite(inner) });
    await expect(startToEnd(stopped, purchase)).rejects.toThrow('the process stops');

    const next = testRuntime({ store: recordingStore(inner) });
    next.clock.set(2000n);
    expect(await startToEnd(next, opening('  0'))).toEqual({ kind: 'finished', outcome: '0' });
    expect(next.runtime.inspect('o/1').state).toEqual({
      kind: 'waiting',
      until: undefined,
      watching: [],
    });
  });

  it('stops its work once its Runtime is disposed, until the next Runtime.open resumes it', async () => {
    const disposing = opening(
      '  drop rt.call("o/1") purchase(Order{id: "o/1", amount: 21})',
      '  await time.delay(100ms)',
      '  drop rt',
      '  await time.delay(2s)',
      '  0',
    );
    const test = testRuntime();
    expect(await startToEnd(test, disposing)).toEqual({ kind: 'finished', outcome: '0' });
    expect(test.runtime.inspect('o/1').state).toEqual({
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
        '  drop rt.call("o/1") touch()',
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
    expect(test.runtime.inspect('o/1').state).toEqual({
      kind: 'waiting',
      until: undefined,
      watching: [],
    });
  });

  it('disposes what a call still waiting holds as its instance finishes, before its constants', async () => {
    const finishedFirst = compiledEncoded(
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
        'ista async fn spawner() -> String:',
        '  drop spawn child()',
        '  await runtime.commit()',
        '  "spawned"',
        'live async fn main() -> String:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop await rt.call("o/1") spawner()',
        '  match await rt.call("o/1/1") slowQuery():',
        '    case Ok(v): `ok:${v}`',
        '    case Err(e): e.message',
      ),
    );
    const logged: string[] = [];
    const test = testRuntime({
      reports: {
        logs: (records) => logged.push(...records.map(({ message }) => message)),
        panicked: () => undefined,
      },
    });
    expect(await startToEnd(test, finishedFirst)).toMatchObject({ kind: 'finished' });
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
        '  drop rt.call("o/1") bad()',
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
    expect(panicked).toEqual(['o/1: bad']);
  });
});
