/**
 * `spawn` through the runtime's host API, on programs the real compiler builds (spec §9): a
 * spawned instance runs on its own snapshot, exists only once its parent's segment commits, is
 * written before that commit and never twice, takes its parent's options, and carries a sendable
 * closure's captures. Inspecting an instance shows where it waits.
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
  "import * as time from 'time'",
  'async fn child(n: Int) -> Future<Int>:',
  '  await time.delay(10ms)',
  '  n * 2',
  'async fn main() -> Future<Int>:',
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
    const started = await test.runtime.deploy(compiledText(spawningMain)).start('p');
    expect(started.spawned).toEqual(['p/1']);
    const settled = await settleAll(test, 'p', started);
    expect([...settled.keys()]).toEqual(['p', 'p/1', 'p/2']);
    expect(await runToEnd(test, 'p', started)).toEqual({ kind: 'finished', outcome: '5' });
    expect(settled.get('p/1')).toMatchObject({ kind: 'finished', outcome: 2n });
    expect(settled.get('p/2')).toMatchObject({ kind: 'finished', outcome: 4n });
  });

  it("writes a child before its parent's commit, as a call not yet started", async () => {
    const test = testRuntime();
    await test.runtime.deploy(compiledText(spawningMain)).start('p');
    const [child, parent] = readBack(test.store);
    expect(child?.instance).toBe('p/1');
    expect(child?.status).toMatchObject({ kind: 'unstarted' });
    expect(parent).toMatchObject({ instance: 'p', spawned: 1 });
  });

  it('spawns nothing from a segment that panics', async () => {
    const text = compiledText(
      spawningMain.replace('  spawn child(1)', '  spawn child(1)\n  panic("no")'),
    );
    const test = testRuntime();
    const started = await test.runtime.deploy(text).start('p');
    expect(started).toMatchObject({ state: { kind: 'panicked' }, spawned: [] });
    expect(readBack(test.store).map((snapshot) => snapshot.instance)).toEqual(['p']);
  });

  it("doesn't write a child twice when its parent's segment re-runs after a crash", async () => {
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
    await expect(
      testRuntime({ store: crashingOnce }).runtime.deploy(text).start('p'),
    ).rejects.toThrow('crash');
    const started = await testRuntime({ store: inner }).runtime.deploy(text).start('p');
    expect(started.spawned).toEqual(['p/1']);
    const children = readBack(inner).filter((snapshot) => snapshot.instance === 'p/1');
    expect(children).toHaveLength(1);
  });

  it("gives a child its parent's crashEveryAwait", async () => {
    const test = testRuntime();
    await test.runtime.deploy(compiledText(spawningMain)).start('p', { crashEveryAwait: true });
    expect(readBack(test.store).find((snapshot) => snapshot.instance === 'p/1')).toMatchObject({
      crashEveryAwait: true,
    });
  });

  it("carries a sendable closure's captures into the child", async () => {
    const text = compiledText(
      [
        'async fn main() -> Future<Int>:',
        '  const base = 40',
        '  const add = fn(n: Int): base + n',
        '  spawn add(2)',
        '  0',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = await test.runtime.deploy(text).start('p');
    expect((await settleAll(test, 'p', started)).get('p/1')).toMatchObject({
      kind: 'finished',
      outcome: 42n,
    });
  });
});

describe('inspecting an instance', () => {
  it('shows where each execution waits, and how the instance stands', async () => {
    const test = testRuntime();
    await test.runtime.deploy(compiledText(spawningMain)).start('p');
    const { state, waitingAt } = test.runtime.inspect('p');
    expect(state).toEqual({ kind: 'waiting', until: 1n, watching: [] });
    expect(waitingAt).toEqual([{ waypoint: undefined, location: 'memory:main:7:3' }]);
    expect(test.runtime.inspect('p/1')).toEqual({ state: { kind: 'ready' }, waitingAt: [] });
  });
});
