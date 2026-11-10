/**
 * Waiting for another instance's end through the runtime's host API, on programs the real compiler
 * builds (spec §9): `result()` gives a child's outcome or its panic as a `Result`, across a fresh
 * runtime too; `runtime.isolate` terminates its panicked child, which keeps the panic; a waiting
 * instance names the instances it waits for, so a host wakes it once one has ended, even one that
 * ended before the wait began; and a resolved wait nothing awaits still commits.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { ManualClock } from '../../clock.ts';
import { recordingStore, runToEnd, settleAll, testRuntime } from '../../runtime.test-kit.ts';

/** `main` waiting for a child that waits first, then isolating a function that panics. */
const waitingMain = compiledText(
  [
    "import * as runtime from 'runtime'",
    "import * as time from 'time'",
    'ista async fn child(n: Int) -> Int:',
    '  await time.delay(10ms)',
    '  n * 2',
    'fn broken() -> Int: panic("broken")',
    'ista async fn main() -> String:',
    '  const doubled = await (spawn child(21)).result()',
    '  const isolated = await runtime.isolate(fn(): broken())',
    '  match (doubled, isolated):',
    '    case (Ok(value), Err(error)): "" + value + " " + error.code + " " + error.message',
    '    case _: "unexpected"',
  ].join('\n'),
);

describe("waiting for an instance's end", () => {
  it("gives a child's outcome, and an isolated panic as an Err, terminating that child", async () => {
    const test = testRuntime();
    const started = await test.runtime.deploy(waitingMain).start('p');
    expect(started.state).toEqual({ kind: 'waiting', until: undefined, watching: ['p/1'] });
    const settled = await settleAll(test, 'p', started);
    expect(await runToEnd(test, 'p', await test.runtime.wake('p'))).toEqual({
      kind: 'finished',
      outcome: '"42 panic broken"',
    });
    expect(settled.get('p/2')).toMatchObject({ kind: 'terminated', message: 'broken' });
  });

  it('wakes the waiting parent on a fresh runtime once its child has ended there', async () => {
    const store = recordingStore();
    const clock = new ManualClock();
    const first = testRuntime({ store, clock });
    await first.runtime.deploy(waitingMain).start('p');
    expect((await first.runtime.wake('p/1')).state).toMatchObject({ kind: 'waiting', until: 10n });
    const restarted = testRuntime({ store, clock });
    clock.set(10n);
    expect((await restarted.runtime.wake('p/1')).state).toMatchObject({
      kind: 'finished',
      outcome: 42n,
    });
    expect(await runToEnd(restarted, 'p', await restarted.runtime.wake('p'))).toEqual({
      kind: 'finished',
      outcome: '"42 panic broken"',
    });
  });

  it('resolves a wait on an instance that ended before the wait began', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'fn quick() -> Int: 7',
        'ista async fn main() -> String:',
        '  const child = spawn quick()',
        '  await time.delay(5ms)',
        '  match await child.result():',
        '    case Ok(value): "" + value',
        '    case Err(error): error.message',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = await test.runtime.deploy(text).start('p');
    expect(await runToEnd(test, 'p', started)).toEqual({ kind: 'finished', outcome: '"7"' });
  });

  it('commits a resolved wait nothing awaits, so its instance stops being woken for it', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'fn quick() -> Int: 7',
        'ista async fn main() -> Int:',
        '  const ending = (spawn quick()).result()',
        '  await time.delay(5ms)',
        '  match await ending:',
        '    case Ok(value): value',
        '    case Err(error): 0',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = await test.runtime.deploy(text).start('p');
    expect(started.state).toMatchObject({ watching: ['p/1'] });
    const child = await test.runtime.wake('p/1');
    expect(child.state).toMatchObject({ kind: 'finished', outcome: 7n });
    expect((await test.runtime.wake('p')).state).toEqual({
      kind: 'waiting',
      until: 5n,
      watching: [],
    });
    expect(await runToEnd(test, 'p', await test.runtime.wake('p'))).toEqual({
      kind: 'finished',
      outcome: '7',
    });
  });
});
