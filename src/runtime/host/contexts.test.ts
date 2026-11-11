/**
 * Contexts (§9): live code opens a runtime over the host's store and calls ista code in a context,
 * an instance named by its key, which commits as any instance does while the live run waits in
 * memory. A call's answer is `Ok` of what it gave or `Err` of its panic, the same when the context
 * crashes at every await, and a context stopped mid-invocation resumes at the store's next open.
 */

import { describe, expect, it } from 'vitest';
import { reported } from '../../compiler/checker/check.test-kit.ts';
import { checkerDiagnostics } from '../../compiler/checker/diagnostics/index.ts';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { recordingStore, startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { memoryStore } from '../store.ts';

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
  'ista async fn refund(order: Order) -> Int: panic("no refunds for " + order.id)',
];

/** A program whose live `main` calls `call` in the context "o/1", giving `Ok`'s value or `-1`. */
function calling(call: string): string {
  return compiledText(
    lines(
      ...header,
      'live async fn main() -> Int:',
      '  const rt = await runtime.Runtime.open(runtime.hostStore())',
      `  match await rt.call("o/1") ${call}:`,
      '    case Ok(value): value',
      '    case Err(error): error.message.length()',
    ),
  );
}

const purchase = calling('purchase(Order{id: "o/1", amount: 21})');

describe('a context', () => {
  it('answers a live call with Ok of what the ista code gave', async () => {
    expect(await startToEnd(testRuntime(), purchase)).toEqual({ kind: 'finished', outcome: '42' });
  });

  it('answers the same when it crashes at every await', async () => {
    const ended = await startToEnd(testRuntime(), purchase, { crashEveryAwait: true });
    expect(ended).toEqual({ kind: 'finished', outcome: '42' });
  });

  it('answers a panic with Err of it', async () => {
    const ended = await startToEnd(testRuntime(), calling('refund(Order{id: "o/1", amount: 1})'));
    expect(ended).toEqual({ kind: 'finished', outcome: `${'no refunds for o/1'.length}` });
  });

  it('refuses an argument or result that is not sendable', () => {
    const unsendableArg = lines(
      ...header,
      'ista async fn opened(rt: runtime.Runtime) -> Int: 1',
      'live async fn main() -> Int:',
      '  const rt = await runtime.Runtime.open(runtime.hostStore())',
      '  _ = rt.call("o/1") opened(rt)',
      '  1',
    );
    expect(reported(unsendableArg).codes).toContain(checkerDiagnostics.unsendableCapture.code);

    const unsendableResult = lines(
      ...header,
      'ista async fn sharedResult() -> Shared<Int>: new Shared{value: 1}',
      'live async fn main() -> Int:',
      '  const rt = await runtime.Runtime.open(runtime.hostStore())',
      '  _ = rt.call("o/1") sharedResult()',
      '  1',
    );
    expect(reported(unsendableResult).codes).toContain(checkerDiagnostics.notConforming.code);
  });

  it('commits to the store while the live run waits in memory, which never reaches it', async () => {
    const test = testRuntime();
    await startToEnd(test, purchase);
    expect(test.store.commits.length).toBeGreaterThan(1);
    expect(test.store.readSnapshot('test')).toBeUndefined();
    expect(test.runtime.inspect('o/1').state).toMatchObject({ kind: 'waiting', until: undefined });
  });

  it('starts a new invocation on every call', async () => {
    const twice = compiledText(
      lines(
        ...header,
        'live async fn main() -> Int:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  const first = rt.call("o/1") purchase(Order{id: "a", amount: 1})',
        '  const second = rt.call("o/1") purchase(Order{id: "b", amount: 2})',
        '  match (await first, await second):',
        '    case (Ok(one), Ok(two)): one * 10 + two',
        '    case _: -1',
      ),
    );
    expect(await startToEnd(testRuntime(), twice)).toEqual({ kind: 'finished', outcome: '24' });
  });

  it('stopped mid-invocation, resumes at the next open of its store', async () => {
    const inner = memoryStore();
    let writes = 0;
    const crashing = recordingStore({
      ...inner,
      writeSnapshot: (instance, text) => {
        writes += 1;
        if (writes > 1) {
          throw new Error('the process stops');
        }
        inner.writeSnapshot(instance, text);
      },
    });
    const stopped = testRuntime({ store: crashing });
    await expect(startToEnd(stopped, purchase)).rejects.toThrow('the process stops');
    expect(stopped.runtime.inspect('o/1').state).toMatchObject({ kind: 'waiting' });
    expect(stopped.runtime.inspect('o/1').state).not.toMatchObject({ until: undefined });

    const opening = compiledText(
      lines(
        ...header,
        'live async fn main() -> Int:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  await time.delay(1h)',
        '  0',
      ),
    );
    const next = testRuntime({ store: recordingStore(inner) });
    expect(await startToEnd(next, opening)).toEqual({ kind: 'finished', outcome: '0' });
    expect(next.runtime.inspect('o/1').state).toMatchObject({ kind: 'waiting', until: undefined });
  });

  it('resumes a context whose timer is already due as soon as Runtime.open awaits, without another live wait', async () => {
    const inner = memoryStore();
    let writes = 0;
    const crashing = recordingStore({
      ...inner,
      writeSnapshot: (instance, text) => {
        writes += 1;
        if (writes > 1) {
          throw new Error('the process stops');
        }
        inner.writeSnapshot(instance, text);
      },
    });
    const stopped = testRuntime({ store: crashing });
    await expect(startToEnd(stopped, purchase)).rejects.toThrow('the process stops');

    const opening = compiledText(
      lines(
        ...header,
        'live async fn main() -> Int:',
        '  const _rt = await runtime.Runtime.open(runtime.hostStore())',
        '  0',
      ),
    );
    const next = testRuntime({ store: recordingStore(inner) });
    next.clock.set(2_000n);
    expect(await startToEnd(next, opening)).toEqual({ kind: 'finished', outcome: '0' });
    expect(next.runtime.inspect('o/1').state).toEqual({
      kind: 'waiting',
      until: undefined,
      watching: [],
    });
  });

  it('disposing a Runtime stops its work until the next Runtime.open resumes it (§9)', async () => {
    const stoppedByDispose = compiledText(
      lines(
        ...header,
        'live async fn main() -> Int:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop rt.call("o/1") purchase(Order{id: "o/1", amount: 21})',
        '  await time.delay(100ms)',
        '  drop rt',
        '  await time.delay(2s)',
        '  0',
      ),
    );
    const test = testRuntime();
    expect(await startToEnd(test, stoppedByDispose)).toEqual({ kind: 'finished', outcome: '0' });
    // Because `rt` was disposed at 100ms and never reopened, `o/1` must still be waiting on its 1s timer.
    expect(test.runtime.inspect('o/1').state).toEqual({
      kind: 'waiting',
      until: 1000n,
      watching: [],
    });
  });

  it('starts an invocation when its Call is released without being awaited', async () => {
    const unawaited = compiledText(
      lines(
        "import * as runtime from 'runtime'",
        'ista fn touch() -> Int: 1',
        'live async fn main() -> Int:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  drop rt.call("o/1") touch()',
        '  0',
      ),
    );
    const test = testRuntime();
    expect(await startToEnd(test, unawaited)).toEqual({ kind: 'finished', outcome: '0' });
    expect(test.runtime.inspect('o/1').state).toEqual({
      kind: 'waiting',
      until: undefined,
      watching: [],
    });
  });

  it('Runtime is Disposable (§9)', () => {
    const disposableRuntime = lines(
      "import * as runtime from 'runtime'",
      'live fn watch(rt: runtime.Runtime) -> WeakRef<runtime.Runtime>: WeakRef(rt)',
    );
    expect(reported(disposableRuntime).codes).toEqual([]);
  });

  it('ends a call waiting on an instance when the instance finishes before the call answers', async () => {
    const finishedFirst = compiledText(
      lines(
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'ista async fn child() -> Int:',
        '  await time.delay(10ms)',
        '  1',
        'ista async fn slowQuery() -> Int:',
        '  await time.delay(1s)',
        '  2',
        'ista async fn spawner() -> String:',
        '  const c = spawn child()',
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
    expect(await startToEnd(testRuntime(), finishedFirst)).toEqual({
      kind: 'finished',
      outcome: '"The context \'o/1/1\' has ended."',
    });
  });

  it('disposes what a call still waiting holds when its instance finishes, before its constants', async () => {
    const finishedFirst = compiledText(
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

  it('runs a context a timer readied before the live run decides what waited on both', async () => {
    const readied = compiledText(
      lines(
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'ista async fn child() -> Int:',
        '  await time.delay(5ms)',
        '  1',
        'ista async fn parent() -> String:',
        '  drop await spawn(child).result()',
        '  "context"',
        'live async fn main() -> String:',
        '  const rt = await runtime.Runtime.open(runtime.hostStore())',
        '  const call = rt.call("o/1") parent()',
        '  await select:',
        '    case call as answer:',
        '      drop answer',
        '      "context"',
        '    case time.delay(5ms): "timer"',
      ),
    );
    expect(await startToEnd(testRuntime(), readied)).toEqual({
      kind: 'finished',
      outcome: '"context"',
    });
  });

  it("tells the host of a context's panic that only a call let go of was waiting on", async () => {
    const dropped = compiledText(
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

describe('a host', () => {
  it('lists only live and simple code in starts, never ista functions', () => {
    const program = testRuntime().runtime.deploy(purchase);
    expect(program.starts).toEqual(['main.main()']);
  });

  it('refuses to start ista code, which only runs in a context', async () => {
    const program = testRuntime().runtime.deploy(purchase);
    await expect(
      program.start('direct', {
        function: 'main.purchase(main.Order)',
        arguments: [{ id: 'o/1', amount: 1 }],
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        reason: 'notStartable',
      }),
    );
  });
});
