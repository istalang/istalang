/**
 * Waiting for another instance's end through the runtime's host API, on programs the real compiler
 * builds (spec §9): `result()` gives a child's outcome or its panic as a `Result`, across a fresh
 * runtime too; `runtime.isolate` terminates its panicked child, which keeps the panic; a waiting
 * instance names the instances it waits for, so a host wakes it once one has ended, even one that
 * ended before the wait began; and a resolved wait nothing awaits still commits.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import {
  manualClock,
  recordingStore,
  runToEnd,
  settleAll,
  testRuntime,
} from '../runtime.test-kit.ts';

/** `main` waiting for a child that waits first, then isolating a function that panics. */
const waitingMain = compiledText(
  [
    "import * as runtime from 'runtime'",
    "import * as time from 'time'",
    'async fn child(n: int) -> Future<int>:',
    '  await time.delay(10ms)',
    '  n * 2',
    'fn broken() -> int: panic("broken")',
    'async fn main() -> Future<string>:',
    '  const doubled = await spawn child(21).result()',
    '  const isolated = await runtime.isolate(fn(): broken())',
    '  match (doubled, isolated):',
    '    case (Ok{value}, Err{error}): "" + value + " " + error.code + " " + error.message',
    '    case _: "unexpected"',
  ].join('\n'),
);

describe("waiting for an instance's end", () => {
  it("gives a child's outcome, and an isolated panic as an Err, terminating that child", () => {
    const test = testRuntime();
    const started = test.runtime.deploy(waitingMain).start('p');
    expect(started.state).toEqual({ kind: 'waiting', until: undefined, watching: ['p/1'] });
    const settled = settleAll(test, 'p', started);
    expect(runToEnd(test, 'p', test.runtime.wake('p'))).toEqual({
      kind: 'finished',
      outcome: '"42 panic broken"',
    });
    expect(settled.get('p/2')).toMatchObject({ kind: 'terminated', message: 'broken' });
  });

  it('wakes the waiting parent on a fresh runtime once its child has ended there', () => {
    const store = recordingStore();
    const clock = manualClock();
    const first = testRuntime({ store, clock });
    first.runtime.deploy(waitingMain).start('p');
    expect(first.runtime.wake('p/1').state).toMatchObject({ kind: 'waiting', until: 10n });
    const restarted = testRuntime({ store, clock });
    clock.set(10n);
    expect(restarted.runtime.wake('p/1').state).toMatchObject({ kind: 'finished', outcome: 42n });
    expect(runToEnd(restarted, 'p', restarted.runtime.wake('p'))).toEqual({
      kind: 'finished',
      outcome: '"42 panic broken"',
    });
  });

  it('resolves a wait on an instance that ended before the wait began', () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'fn quick() -> int: 7',
        'async fn main() -> Future<string>:',
        '  const child = spawn quick()',
        '  await time.delay(5ms)',
        '  match await child.result():',
        '    case Ok{value}: "" + value',
        '    case Err{error}: error.message',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = test.runtime.deploy(text).start('p');
    expect(runToEnd(test, 'p', started)).toEqual({ kind: 'finished', outcome: '"7"' });
  });

  it('commits a resolved wait nothing awaits, so its instance stops being woken for it', () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'fn quick() -> int: 7',
        'async fn main() -> Future<int>:',
        '  const ending = spawn quick().result()',
        '  await time.delay(5ms)',
        '  match await ending:',
        '    case Ok{value}: value',
        '    case Err{error}: 0',
      ].join('\n'),
    );
    const test = testRuntime();
    const started = test.runtime.deploy(text).start('p');
    expect(started.state).toMatchObject({ watching: ['p/1'] });
    const child = test.runtime.wake('p/1');
    expect(child.state).toMatchObject({ kind: 'finished', outcome: 7n });
    expect(test.runtime.wake('p').state).toEqual({ kind: 'waiting', until: 5n, watching: [] });
    expect(runToEnd(test, 'p', test.runtime.wake('p'))).toEqual({ kind: 'finished', outcome: '7' });
  });
});
