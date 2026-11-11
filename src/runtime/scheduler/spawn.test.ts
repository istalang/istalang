/**
 * `spawn` through the runtime's host API, on programs the real compiler builds (spec §9): a
 * spawned instance runs on its own snapshot, exists only once its parent's segment commits, is
 * written before that commit and never twice, takes its parent's options, and carries a sendable
 * closure's captures. Its root ends with the value of the future its function gives, which a plain
 * root waits on at its `return`, and every spawning native's instance has its outcome encoded for
 * its host. Inspecting an instance shows where it waits.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import {
  type RecordingStore,
  recordingStore,
  runToEnd,
  settleAll,
  testRuntime,
} from '../runtime.test-kit.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';

/** `main` spawning two children that each wait before giving their outcome. */
const spawningMain = [
  "import * as time from 'time'\nimport * as runtime from 'runtime'",
  'ista async fn child(n: Int) -> Int:',
  '  await time.delay(10ms)',
  '  n * 2',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
  '  spawn child(1)',
  '  await time.delay(1ms)',
  '  spawn child(2)',
  '  5',
].join('\n');

const readBack = (store: RecordingStore): readonly Snapshot[] =>
  store.commits.map((text) => snapshotFormat.read(text));

describe('spawning an instance', () => {
  it('runs each child on its own snapshot, named after its parent, to its own outcome', async () => {
    const test = testRuntime();
    const started = test.startInstance(compiledText(spawningMain), 'p');
    expect(started.spawned).toEqual(['p/1']);
    const settled = await settleAll(test, 'p', started);
    expect([...settled.keys()]).toEqual(['p', 'p/1', 'p/2']);
    expect(await runToEnd(test, 'p', started)).toEqual({ kind: 'finished', outcome: 5n });
    expect(settled.get('p/1')).toMatchObject({ kind: 'finished', outcome: 2n });
    expect(settled.get('p/2')).toMatchObject({ kind: 'finished', outcome: 4n });
  });

  it("writes a child before its parent's commit, as a call not yet started", () => {
    const test = testRuntime();
    test.startInstance(compiledText(spawningMain), 'p');
    const [child, parent] = readBack(test.store);
    expect(child?.instance).toBe('p/1');
    expect(child?.status).toMatchObject({ kind: 'unstarted' });
    expect(parent).toMatchObject({ instance: 'p', spawned: 1 });
  });

  it('spawns nothing from a segment that panics', () => {
    const text = compiledText(
      spawningMain.replace('  spawn child(1)', '  spawn child(1)\n  panic("no")'),
    );
    const test = testRuntime();
    const started = test.startInstance(text, 'p');
    expect(started).toMatchObject({ state: { kind: 'panicked' }, spawned: [] });
    expect(readBack(test.store).map((snapshot) => snapshot.instance)).toEqual(['p']);
  });

  it("doesn't write a child twice when its parent's segment re-runs after a crash", () => {
    const inner = recordingStore();
    let crashed = false;
    const crashingOnce: RecordingStore = {
      ...inner,
      writeSnapshot: (instance, snapshotText) => {
        if (instance === 'p' && !crashed) {
          crashed = true;
          throw new Error('crash');
        }
        inner.writeSnapshot(instance, snapshotText);
      },
    };
    const text = compiledText(spawningMain);
    expect(() => testRuntime({ store: crashingOnce }).startInstance(text, 'p')).toThrow('crash');
    const started = testRuntime({ store: inner }).startInstance(text, 'p');
    expect(started.spawned).toEqual(['p/1']);
    const children = readBack(inner).filter((snapshot) => snapshot.instance === 'p/1');
    expect(children).toHaveLength(1);
  });

  it("gives a child its parent's crashEveryAwait", () => {
    const test = testRuntime();
    test.startInstance(compiledText(spawningMain), 'p', { crashEveryAwait: true });
    expect(readBack(test.store).find((snapshot) => snapshot.instance === 'p/1')).toMatchObject({
      crashEveryAwait: true,
    });
  });

  it("carries a sendable closure's captures into the child", async () => {
    const text = compiledText(
      [
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  const base = 40',
        '  const add = fn(n: Int): base + n',
        '  spawn add(2)',
        '  0',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = test.startInstance(text, 'p');
    expect((await settleAll(test, 'p', started)).get('p/1')).toMatchObject({
      kind: 'finished',
      outcome: 42n,
    });
  });

  it('starts a child through a shorter function value, its function computing what it left out', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'ista async fn work(x: Int = 42) -> Int:',
        '  await time.delay(1ms)',
        '  x',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const f: sendable ista async fn() -> Int = work',
        '  drop spawn(f)',
        '  0',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = test.startInstance(text, 'p');
    expect((await settleAll(test, 'p', started)).get('p/1')).toMatchObject({
      kind: 'finished',
      outcome: 42n,
    });
  });
});

/** `main` spawning an async callee, which waits across commits, and a plain one. */
const awaitingMain = [
  "import * as time from 'time'\nimport * as runtime from 'runtime'",
  'ista async fn child(n: Int) -> Int:',
  '  await time.delay(10ms)',
  '  n * 2',
  'fn twice(n: Int) -> Int: n * 2',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
  '  spawn child(1)',
  '  spawn twice(2)',
  '  0',
].join('\n');

/** How each instance `text`'s `main`, started as `p`, spawns ends: its outcome's JSON text. */
async function spawnedOutcomes(
  text: string,
  options: { readonly crashEveryAwait?: boolean } = {},
): Promise<ReadonlyMap<string, string>> {
  const test = testRuntime();
  const settled = await settleAll(test, 'p', test.startInstance(text, 'p', options));
  const program = test.programOf('p');
  return new Map(
    [...settled].flatMap(([name, state]) =>
      name === 'p' || state.kind !== 'finished' ? [] : [[name, program.outcomeText(state)]],
    ),
  );
}

describe("a spawned instance's root", () => {
  it.each([false, true])(
    'ends with the value of the future its function gives, an async or a plain callee, crashing every await: %s',
    async (crashEveryAwait) => {
      expect(await spawnedOutcomes(compiledText(awaitingMain), { crashEveryAwait })).toEqual(
        new Map([
          ['p/1', '2'],
          ['p/2', '4'],
        ]),
      );
    },
  );

  it('commits the future a plain root gave as the outcome it awaits, no frame waiting for it', async () => {
    const test = testRuntime();
    test.startInstance(compiledText(awaitingMain), 'p');
    await test.runtime.wake('p/1');
    const child = readBack(test.store).findLast((snapshot) => snapshot.instance === 'p/1');
    const objects = child?.objects ?? [];
    const awaited = objects.flatMap((object) => (object.kind === 'outcome' ? [object.future] : []));
    const executions = objects.flatMap((object) =>
      object.kind === 'execution' ? [object.resolves] : [],
    );
    expect(executions).toHaveLength(1);
    expect(awaited).toEqual(executions);
    expect(test.runtime.inspect('p/1').waitingAt).toEqual([
      { waypoint: undefined, location: 'memory:main:4:3' },
    ]);
  });

  it("encodes the outcome of an instance runtime.isolate spawns, as spawn's", async () => {
    const text = compiledText(
      [
        "import * as runtime from 'runtime'",
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  drop runtime.isolate(fn(): "isolated")',
        '  0',
      ].join('\n'),
    );
    expect(await spawnedOutcomes(text)).toEqual(new Map([['p/1', '"isolated"']]));
  });

  it('starts an instance when given a future-returning extern as a function value', async () => {
    const text = compiledText(
      [
        "import * as runtime from 'runtime'",
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  drop await spawn(runtime.commit).result()',
        '  drop await runtime.isolate(runtime.commit)',
        '  0',
      ].join('\n'),
    );
    expect(await spawnedOutcomes(text)).toEqual(
      new Map([
        ['p/1', 'null'],
        ['p/2', 'null'],
      ]),
    );
  });

  it('disposes the awaited outcome call on terminate (running its disposing() cleanup), and disposes a disposable outcome when it finishes (§7, §9)', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        "import * as log from 'log'\nimport * as runtime from 'runtime'",
        'shared struct Lease { name: String }',
        'fn dispose(self: Lease): log.info("disposed " + self->name)',
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
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  drop spawn worker()',
        '  drop spawn makesLease()',
        '  0',
      ].join('\n'),
    );
    const test = testRuntime();
    test.startInstance(text, 'p');
    await test.runtime.wake('p/1');
    await test.runtime.wake('p/2');
    test.clock.set(test.clock.now() + 5n);
    await test.runtime.wake('p/1');
    const terminated = await test.runtime.terminate('p/1');
    expect(terminated.logs.map(({ message }) => message)).toEqual(['worker graceful cleanup']);
    const finished = await test.runtime.wake('p/2');
    expect(finished.logs.map(({ message }) => message)).toEqual(['disposed awaited']);
  });
});

describe('inspecting an instance', () => {
  it('shows where each execution waits, and how the instance stands', () => {
    const test = testRuntime();
    test.startInstance(compiledText(spawningMain), 'p');
    const { state, waitingAt } = test.runtime.inspect('p');
    expect(state).toEqual({ kind: 'waiting', until: 1n, watching: [] });
    expect(waitingAt).toEqual([{ waypoint: undefined, location: 'memory:main:9:3' }]);
    expect(test.runtime.inspect('p/1')).toEqual({ state: { kind: 'ready' }, waitingAt: [] });
  });
});
