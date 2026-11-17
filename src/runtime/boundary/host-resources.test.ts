/**
 * A host type a `dispose` makes disposable (§3.6, §7), on programs the real compiler builds: each
 * value arrives from the host as a resource holding the host's JSON, lives in the instance across
 * commits like any other object, leaves to the host as that JSON, and is disposed by its `dispose`
 * once nothing holds it, which tells the host. A queue the host provides hands out a revertible
 * send as one, held by the inbox module's `Revertible<T>` (§6).
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { ManualClock } from '../clock.ts';
import { recordingStore, startToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostExterns } from './host-natives.ts';

/** The declarations of a lease the host gives and releases. */
const leases = [
  "import * as time from 'time'",
  "import * as runtime from 'runtime'",
  'extern shared struct Lease',
  'extern fn open(name: String) -> Lease',
  'extern fn describe(lease: Lease) -> String',
  'extern fn release(lease: Lease)',
  'extern fn ready() -> Bool',
  'fn dispose(self: Lease):',
  '  release(self)',
];

/** `_main` spawning `test/1`, which holds a lease across a commit. */
const leasing = compiledEncoded(
  lines(
    ...leases,
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
    'ista async fn holding() -> String:',
    '  const lease = open("a")',
    '  await time.delay(1s)',
    '  describe(lease)',
    'ista async fn _main() -> Int:',
    '  spawn holding()',
    '  0',
  ),
);

const terminated = compiledEncoded(
  lines(
    ...leases,
    'live async fn main() -> String: await runtime.run(runtime.id()) _main()',
    'ista async fn _main() -> String:',
    '  const first = open("plain")',
    '  const second = open("refusing")',
    '  await time.delay(1s)',
    '  if not ready():',
    '    panic("refused")',
    '  describe(first) + describe(second)',
  ),
);

/**
 * A host that leases by name, recording every lease it is told to release, and what it had
 * released as each lease was described.
 */
function leasingHost() {
  const released: unknown[] = [];
  const releasedAtDescribe: unknown[][] = [];
  const host: HostExterns = {
    'main.open(String)': ([name]) => ({ id: name }),
    'main.describe(main.Lease)': ([lease]) => {
      releasedAtDescribe.push([...released]);
      return (lease as { id: string }).id;
    },
    'main.release(main.Lease)': ([lease]) => {
      released.push(lease);
      return null;
    },
    'main.ready()': () => false,
  };
  return { host, released, releasedAtDescribe };
}

describe('a disposable host type', () => {
  it('keeps what the host gave across commits, read back by a fresh runtime, and tells the host once nothing holds it', async () => {
    const { host, released, releasedAtDescribe } = leasingHost();
    const store = recordingStore();
    const clock = new ManualClock();
    expect(await startToEnd(testRuntime({ externs: host, store, clock }), leasing)).toEqual({
      kind: 'finished',
      outcome: '0',
    });
    expect(released).toEqual([]);
    const restarted = testRuntime({ externs: host, store, clock });
    clock.set(1000n);
    expect((await restarted.runtime.wake('test/1')).state).toMatchObject({
      kind: 'finished',
      outcome: 'a',
    });
    expect(releasedAtDescribe).toEqual([[]]);
    expect(released).toEqual([{ id: 'a' }]);
  });

  it('is disposed when its panicked instance is terminated, even after another disposal panics', async () => {
    const { host, released } = leasingHost();
    const refusing: HostExterns = {
      ...host,
      'main.release(main.Lease)': ([lease]) => {
        released.push(lease);
        return (lease as { id: string }).id === 'refusing' ? 'not unit' : null;
      },
    };
    const test = testRuntime({ externs: refusing });
    expect(await startToEnd(test, terminated)).toMatchObject({ kind: 'panicked' });
    expect(released).toEqual([]);
    expect((await test.runtime.terminate('test')).state).toEqual({
      kind: 'terminated',
      message: 'refused',
      trace: expect.any(String),
    });
    expect(released).toEqual([{ id: 'refusing' }, { id: 'plain' }]);
  });

  it("is disposed by its host when the host implements its 'dispose'", async () => {
    const disposed: unknown[] = [];
    const host: HostExterns = {
      'main.open(String)': ([name]) => ({ id: name }),
      'main.dispose(main.Lease)': ([lease]) => {
        disposed.push(lease);
        return null;
      },
    };
    const program = compiledEncoded(
      lines(
        "import * as runtime from 'runtime'",
        'extern shared struct Lease',
        'extern fn open(name: String) -> Lease',
        'extern fn dispose(self: Lease)',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  const lease = open("b")',
        '  1',
      ),
    );
    expect(await startToEnd(testRuntime({ externs: host }), program)).toEqual({
      kind: 'finished',
      outcome: '1',
    });
    expect(disposed).toEqual([{ id: 'b' }]);
  });

  it('is retracted by its host once the Revertible holding it is released', async () => {
    const calls: unknown[][] = [];
    const host: HostExterns = {
      'main.announcements(String)': ([user]) => ({ queue: user }),
      'main._sendRevertible(main.Queue<T>, T)': (given) => {
        calls.push(['send', ...given]);
        return { message: 7n };
      },
      'main.dispose(main.Sent)': (given) => {
        calls.push(['retract', ...given]);
        return null;
      },
    };
    const program = compiledEncoded(
      lines(
        "import Revertible from 'inbox'",
        "import Encodable from 'json'",
        "import * as runtime from 'runtime'",
        "import * as time from 'time'",
        'extern sendable struct Queue<T is Sendable>',
        'extern shared struct Sent',
        'extern fn dispose(self: Sent)',
        'extern fn _sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Sent',
        'extern fn announcements(user: String) -> Queue<String>',
        'ista fn sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Revertible<T>:',
        '  Revertible.holding(_sendRevertible(self, msg))',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  hold _ = announcements("ann").sendRevertible("hello")',
        '  await time.delay(1s)',
        '  1',
      ),
    );
    expect(await startToEnd(testRuntime({ externs: host }), program)).toEqual({
      kind: 'finished',
      outcome: '1',
    });
    expect(calls).toEqual([
      ['send', { queue: 'ann' }, 'hello'],
      ['retract', { message: 7n }],
    ]);
  });
});
