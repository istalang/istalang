/**
 * Persistence through the runtime's host API, on programs the real compiler builds (spec §5):
 * where segments end and commit, eager async calls inside their caller's segment, a fresh runtime
 * continuing from a store, `crashEveryAwait` re-running segments, `now()` as the segment's start,
 * and panics committing nothing. Every program of the run corpus is wake.sweep.test.ts's.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { elementsOf } from '../../definition/values/values.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import { ManualClock } from '../clock.ts';
import type { Native, Natives } from '../natives.ts';
import {
  type RecordingStore,
  recordingStore,
  runToEnd,
  startToEnd,
  testRuntime,
} from '../runtime.test-kit.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';

const childAndMain = [
  "import * as time from 'time'",
  'ista async fn child(n: Int) -> Int:',
  '  await time.delay(10ms)',
  '  n + 1',
  'ista async fn main():',
  '  const x = await child(41)',
  '  x',
].join('\n');

/**
 * A callee changing its caller's variable through `&` on both sides of a timer: the variable is a
 * cell, and the reference to it waits in the callee's frame across commits (§3.7).
 */
const referenceAcrossAwaits = [
  "import * as time from 'time'",
  'struct Tally { count: Int }',
  'ista async fn addLater(total: &Tally, n: Int):',
  '  total.count += n',
  '  await time.delay(5ms)',
  '  total.count += n',
  'ista async fn main():',
  '  let tally = Tally{count: 1}',
  '  await addLater(&tally, 2)',
  '  tally.count',
].join('\n');

/** Three awaits in sequence, at two depths, adding up arguments. */
const severalAwaits = [
  "import * as time from 'time'",
  "import * as runtime from 'runtime'",
  'ista async fn step(n: Int) -> Int:',
  '  await time.delay(5ms)',
  '  await runtime.commit()',
  '  n + 1',
  'ista async fn main():',
  '  const a = await step(1)',
  '  await time.delay(7ms)',
  '  const b = await step(a)',
  '  a + b',
].join('\n');

const addKey = 'prelude.add(Int, Int)';

/**
 * The std natives, with integer `+` counting its calls in `calls`; with `drifting`, each call's
 * sum is also off by how many calls came before, so no two runs of a segment agree.
 */
function countingAdd(calls: { count: number }, drifting = false): Natives {
  const add: Native | undefined = stdNatives[addKey];
  if (add === undefined) {
    throw new Error(`No native ${addKey}.`);
  }
  return {
    ...stdNatives,
    [addKey]: (values, context) => {
      calls.count += 1;
      const sum = add(values, context);
      return drifting && typeof sum === 'bigint' ? sum + BigInt(calls.count) : sum;
    },
  };
}

const committed = (texts: readonly string[]): readonly Snapshot[] =>
  texts.map((text) => snapshotFormat.read(text));

describe('advancing an instance', () => {
  it("runs an async callee inside its caller's segment, so its first await commits nothing", async () => {
    const test = testRuntime();
    expect(await startToEnd(test, compiledText(childAndMain))).toEqual({
      kind: 'finished',
      outcome: '42',
    });
    const [waiting, finished, ...more] = committed(test.store.commits);
    expect(more).toEqual([]);
    const kinds = waiting?.objects.map((object) => object.kind).sort();
    expect(kinds).toEqual(['execution', 'execution', 'future', 'future', 'resolver', 'resolver']);
    const status = finished?.status;
    expect(status?.kind === 'finished' && test.runtime.programOf('test').outcomeText(status)).toBe(
      '42',
    );
  });

  it('rolls an eager callee back with its caller when the caller panics in the same segment', async () => {
    const text = compiledText(
      childAndMain.replace('  const x = await child(41)', '  const x = await child(panic("no"))'),
    );
    const test = testRuntime();
    expect(await startToEnd(test, text)).toMatchObject({ kind: 'panicked', message: 'no' });
    const [only, ...more] = committed(test.store.commits);
    expect(more).toEqual([]);
    expect(only?.objects).toEqual([]);
    expect(only?.status).toMatchObject({ kind: 'panicked', segmentStartedAt: 0n });
  });

  it('commits at await runtime.commit() and goes on without waiting', async () => {
    const text = compiledText(
      "import * as runtime from 'runtime'\nista async fn main():\n  await runtime.commit()\n  7",
    );
    const test = testRuntime();
    expect(await runToEnd(test, 'i', await test.runtime.deploy(text).start('i'))).toEqual({
      kind: 'finished',
      outcome: '7',
    });
    expect(test.store.commits).toHaveLength(2);
  });

  it('continues on a fresh runtime from the store where the first one committed', async () => {
    const text = compiledText(severalAwaits);
    const uninterrupted = await startToEnd(testRuntime(), text);
    const store = recordingStore();
    const clock = new ManualClock();
    const first = await testRuntime({ store, clock }).runtime.deploy(text).start('restarted');
    expect(first.state).toEqual({ kind: 'waiting', until: 5n, watching: [] });
    const second = testRuntime({ store, clock });
    expect(await runToEnd(second, 'restarted', await second.runtime.wake('restarted'))).toEqual(
      uninterrupted,
    );
    expect(uninterrupted).toEqual({ kind: 'finished', outcome: '5' });
  });

  it("keeps a reference to its caller's variable across a restart and crashEveryAwait", async () => {
    const text = compiledText(referenceAcrossAwaits);
    const uninterrupted = await startToEnd(testRuntime(), text);
    expect(uninterrupted).toEqual({ kind: 'finished', outcome: '5' });
    expect(await startToEnd(testRuntime(), text, { crashEveryAwait: true })).toEqual(uninterrupted);
    const store = recordingStore();
    const clock = new ManualClock();
    const first = await testRuntime({ store, clock }).runtime.deploy(text).start('restarted');
    expect(first.state).toEqual({ kind: 'waiting', until: 5n, watching: [] });
    const second = testRuntime({ store, clock });
    expect(await runToEnd(second, 'restarted', await second.runtime.wake('restarted'))).toEqual(
      uninterrupted,
    );
  });

  it('with crashEveryAwait, runs every segment twice and commits what a normal run commits', async () => {
    const text = compiledText(severalAwaits);
    const normalCalls = { count: 0 };
    const normal = testRuntime({ natives: countingAdd(normalCalls) });
    const crashingCalls = { count: 0 };
    const crashing = testRuntime({ natives: countingAdd(crashingCalls) });
    expect(await startToEnd(crashing, text, { crashEveryAwait: true })).toEqual(
      await startToEnd(normal, text),
    );
    const withoutOption = ({ crashEveryAwait: _, ...rest }: Snapshot) => rest;
    expect(committed(crashing.store.commits).map(withoutOption)).toEqual(
      committed(normal.store.commits).map(withoutOption),
    );
    expect(committed(crashing.store.commits).every((commit) => commit.crashEveryAwait)).toBe(true);
    expect(crashingCalls.count).toBe(2 * normalCalls.count);
  });

  it('with crashEveryAwait, keeps re-running segments on a fresh runtime after a restart', async () => {
    const text = compiledText(severalAwaits);
    const normalCalls = { count: 0 };
    await startToEnd(testRuntime({ natives: countingAdd(normalCalls) }), text);
    const store = recordingStore();
    const clock = new ManualClock();
    const crashingCalls = { count: 0 };
    const first = testRuntime({ natives: countingAdd(crashingCalls), store, clock });
    await first.runtime.deploy(text).start('restarted', { crashEveryAwait: true });
    const second = testRuntime({ natives: countingAdd(crashingCalls), store, clock });
    await runToEnd(second, 'restarted', await second.runtime.wake('restarted'));
    expect(crashingCalls.count).toBe(2 * normalCalls.count);
  });

  it('with crashEveryAwait, panics an instance whose segment runs differently the second time', async () => {
    const crashing = testRuntime({ natives: countingAdd({ count: 0 }, true) });
    expect(
      await startToEnd(crashing, compiledText(severalAwaits), { crashEveryAwait: true }),
    ).toMatchObject({
      kind: 'panicked',
      message: 'This segment ran differently when crashEveryAwait re-ran it.',
    });
  });

  it('answers now() with the time its segment started', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'ista async fn main():',
        '  const before = time.now()',
        '  await time.delay(500ms)',
        '  time.now().value - before.value',
      ].join('\n'),
    );
    const test = testRuntime({ clock: new ManualClock(1000n) });
    expect(await startToEnd(test, text)).toEqual({ kind: 'finished', outcome: '500' });
  });

  it('waits until the earliest timer, and wakes to nothing new before it is due', async () => {
    const test = testRuntime();
    const program = test.runtime.deploy(compiledText(childAndMain));
    expect((await program.start('early')).state).toEqual({
      kind: 'waiting',
      until: 10n,
      watching: [],
    });
    test.clock.set(9n);
    expect((await test.runtime.wake('early')).state).toEqual({
      kind: 'waiting',
      until: 10n,
      watching: [],
    });
    expect(test.store.commits).toHaveLength(1);
  });

  it('commits a timer that came due while nothing waited on it, so its host stops waking it', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'ista async fn main():',
        '  const early = time.delay(5ms)',
        '  await time.delay(10ms)',
        '  await early',
        '  1',
      ].join('\n'),
    );
    const test = testRuntime();
    expect((await test.runtime.deploy(text).start('held')).state).toMatchObject({ until: 5n });
    test.clock.set(5n);
    expect((await test.runtime.wake('held')).state).toEqual({
      kind: 'waiting',
      until: 10n,
      watching: [],
    });
    expect(await runToEnd(test, 'held', await test.runtime.wake('held'))).toEqual({
      kind: 'finished',
      outcome: '1',
    });
  });

  it('keeps a panicked instance frozen at its last commit', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'ista async fn main():',
        '  await time.delay(1ms)',
        '  panic("late")',
      ].join('\n'),
    );
    const test = testRuntime();
    const state = await startToEnd(test, text);
    expect(state).toMatchObject({ kind: 'panicked', message: 'late' });
    expect((await test.runtime.wake('test')).state).toEqual(state);
    const [waiting, panicked] = committed(test.store.commits);
    expect(panicked?.objects).toEqual(waiting?.objects);
    expect(panicked?.status).toMatchObject({ kind: 'panicked', segmentStartedAt: 1n });
  });
});

/** A program whose `main` lets go of a pending `first` over a take, then panics or not. */
function lettingGo(panics: boolean): string {
  return compiledText(
    [
      "import * as futures from 'futures'",
      "import * as runtime from 'runtime'",
      'ista async fn main() -> Int:',
      '  const s = Slot.create<Int>()',
      '  if true:',
      '    const raced = futures.first([s.take()])',
      '    await runtime.commit()',
      ...(panics ? ['  panic("boom")'] : []),
      '  await runtime.commit()',
      '  1',
    ].join('\n'),
  );
}

/**
 * The std natives, with `futures.first` observing the disposal of each future it races, telling
 * `told` how many commits `store` holds as it is told.
 */
function observingFirst(told: number[], store: RecordingStore): Natives {
  const key = Object.keys(stdNatives).find((name) => name.startsWith('futures.first('));
  const first: Native | undefined = key === undefined ? undefined : stdNatives[key];
  if (key === undefined || first === undefined) {
    throw new Error('No native futures.first.');
  }
  return {
    ...stdNatives,
    [key]: (values, context) => {
      for (const raced of elementsOf(values[0] ?? null)) {
        context.futures.onDisposed(raced, () => told.push(store.commits.length));
      }
      return first(values, context);
    },
  };
}

describe("an instance's disposal notices", () => {
  it('tell what observes a future its segment disposed once that segment commits', async () => {
    const told: number[] = [];
    const store = recordingStore();
    const test = testRuntime({ store, natives: observingFirst(told, store) });
    expect(await startToEnd(test, lettingGo(false))).toMatchObject({ kind: 'finished' });
    expect(told).toEqual([2]);
  });

  it('tell nothing for a segment a panic discards', async () => {
    const told: number[] = [];
    const store = recordingStore();
    const test = testRuntime({ store, natives: observingFirst(told, store) });
    expect(await startToEnd(test, lettingGo(true))).toMatchObject({ kind: 'panicked' });
    expect(told).toEqual([]);
  });
});
