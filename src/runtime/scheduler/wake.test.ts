/**
 * Persistence through the runtime's host API, on programs the real compiler builds (spec §5):
 * where segments end and commit, eager async calls inside their caller's segment, a fresh runtime
 * continuing from a store, `crashEveryAwait` re-running segments, `now()` as the segment's start,
 * panics committing nothing, and every program of the run corpus.
 */

import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../test/corpus/run-programs.ts';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { stdNatives } from '../../stdlib/natives.ts';
import type { Natives } from '../natives.ts';
import {
  manualClock,
  recordingStore,
  runToEnd,
  startToEnd,
  testRuntime,
} from '../runtime.test-kit.ts';
import { type Snapshot, snapshotFormat } from '../snapshot/snapshot.ts';

const childAndMain = [
  "import * as time from 'time'",
  'async fn child(n: int) -> Future<int>:',
  '  await time.delay(10ms)',
  '  n + 1',
  'async fn main():',
  '  const x = await child(41)',
  '  x',
].join('\n');

/** Three awaits in sequence, at two depths, adding up arguments. */
const severalAwaits = [
  "import * as time from 'time'",
  "import * as runtime from 'runtime'",
  'async fn step(n: int) -> Future<int>:',
  '  await time.delay(5ms)',
  '  await runtime.commit()',
  '  n + 1',
  'async fn main():',
  '  const a = await step(1)',
  '  await time.delay(7ms)',
  '  const b = await step(a)',
  '  a + b',
].join('\n');

const addKey = 'prelude.add(int, int)';

/**
 * The std natives, with integer `+` counting its calls in `calls`; with `drifting`, each call's
 * sum is also off by how many calls came before, so no two runs of a segment agree.
 */
function countingAdd(calls: { count: number }, drifting = false): Natives {
  const add = stdNatives[addKey];
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
  it("runs an async callee inside its caller's segment, so its first await commits nothing", () => {
    const test = testRuntime();
    expect(startToEnd(test, compiledText(childAndMain))).toEqual({ kind: 'finished', value: 42n });
    const [waiting, finished, ...more] = committed(test.store.commits);
    expect(more).toEqual([]);
    const kinds = waiting?.objects.map((object) => object.kind).sort();
    expect(kinds).toEqual(['execution', 'execution', 'future', 'future']);
    expect(finished?.status).toEqual({ kind: 'finished', outcome: 42n });
  });

  it('rolls an eager callee back with its caller when the caller panics in the same segment', () => {
    const text = compiledText(
      childAndMain.replace('  const x = await child(41)', '  const x = await child(panic("no"))'),
    );
    const test = testRuntime();
    expect(startToEnd(test, text)).toMatchObject({ kind: 'panicked', message: 'no' });
    const [only, ...more] = committed(test.store.commits);
    expect(more).toEqual([]);
    expect(only?.objects).toEqual([]);
    expect(only?.status).toMatchObject({ kind: 'panicked', segmentStartedAt: 0n });
  });

  it('commits at await runtime.commit() and goes on without waiting', () => {
    const text = compiledText(
      "import * as runtime from 'runtime'\nasync fn main():\n  await runtime.commit()\n  7",
    );
    const test = testRuntime();
    expect(test.runtime.deploy(text).start('i')).toEqual({ kind: 'finished', value: 7n });
    expect(test.store.commits).toHaveLength(2);
  });

  it('continues on a fresh runtime from the store where the first one committed', () => {
    const text = compiledText(severalAwaits);
    const uninterrupted = startToEnd(testRuntime(), text);
    const store = recordingStore();
    const clock = manualClock();
    const first = testRuntime({ store, clock }).runtime.deploy(text).start('restarted');
    expect(first).toEqual({ kind: 'waiting', until: 5n });
    const second = testRuntime({ store, clock });
    expect(runToEnd(second, 'restarted', second.runtime.wake('restarted'))).toEqual(uninterrupted);
    expect(uninterrupted).toEqual({ kind: 'finished', value: 5n });
  });

  it('with crashEveryAwait, runs every segment twice and commits what a normal run commits', () => {
    const text = compiledText(severalAwaits);
    const normalCalls = { count: 0 };
    const normal = testRuntime({ natives: countingAdd(normalCalls) });
    const crashingCalls = { count: 0 };
    const crashing = testRuntime({ natives: countingAdd(crashingCalls), crashEveryAwait: true });
    expect(startToEnd(crashing, text)).toEqual(startToEnd(normal, text));
    expect(crashing.store.commits).toEqual(normal.store.commits);
    expect(crashingCalls.count).toBe(2 * normalCalls.count);
  });

  it('with crashEveryAwait, panics an instance whose segment runs differently the second time', () => {
    const crashing = testRuntime({
      natives: countingAdd({ count: 0 }, true),
      crashEveryAwait: true,
    });
    expect(startToEnd(crashing, compiledText(severalAwaits))).toMatchObject({
      kind: 'panicked',
      message: 'This segment ran differently when crashEveryAwait re-ran it.',
    });
  });

  it('answers now() with the time its segment started', () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'async fn main():',
        '  const before = time.now()',
        '  await time.delay(500ms)',
        '  time.now().value - before.value',
      ].join('\n'),
    );
    const test = testRuntime({ clock: manualClock(1000n) });
    expect(startToEnd(test, text)).toEqual({ kind: 'finished', value: 500n });
  });

  it('waits until the earliest timer, and wakes to nothing new before it is due', () => {
    const test = testRuntime();
    const program = test.runtime.deploy(compiledText(childAndMain));
    expect(program.start('early')).toEqual({ kind: 'waiting', until: 10n });
    test.clock.set(9n);
    expect(test.runtime.wake('early')).toEqual({ kind: 'waiting', until: 10n });
    expect(test.store.commits).toHaveLength(1);
  });

  it('keeps a panicked instance frozen at its last commit', () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'async fn main():',
        '  await time.delay(1ms)',
        '  panic("late")',
      ].join('\n'),
    );
    const test = testRuntime();
    const state = startToEnd(test, text);
    expect(state).toMatchObject({ kind: 'panicked', message: 'late' });
    expect(test.runtime.wake('test')).toEqual(state);
    const [waiting, panicked] = committed(test.store.commits);
    expect(panicked?.objects).toEqual(waiting?.objects);
    expect(panicked?.status).toMatchObject({ kind: 'panicked', segmentStartedAt: 1n });
  });

  it.each(runPrograms)('runs $name to the outcome it states', ({ text, expects, expected }) => {
    const test = testRuntime();
    const program = test.runtime.deploy(compiledText(text));
    const state = runToEnd(test, 'corpus', program.start('corpus'));
    const ended =
      state.kind === 'finished'
        ? { expects: 'outcome', expected: program.json(state.value) }
        : { expects: 'panic', expected: state.kind === 'panicked' ? state.message : '' };
    expect(ended).toEqual({ expects, expected });
  });
});
