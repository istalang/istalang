/**
 * A host type a `dispose` makes disposable (§3.6, §7), on programs the real compiler builds: each
 * value arrives from the host as a resource holding the host's JSON, lives in the instance across
 * commits like any other object, leaves to the host as that JSON, and is disposed by its `dispose`
 * once nothing holds it, which tells the host. A queue the host provides hands out a revertible
 * send as one, held by the inbox module's `Revertible<T>` (§6).
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostExterns } from './host-natives.ts';

const leasing = compiledText(
  [
    'extern shared struct Lease',
    '',
    'extern fn open(name: String) -> Lease',
    'extern fn describe(lease: Lease) -> String',
    'extern fn release(lease: Lease)',
    '',
    'fn dispose(self: Lease):',
    '  release(self)',
    '',
    "import * as time from 'time'\nimport * as runtime from 'runtime'\nlive async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String:",
    '  const lease = open("a")',
    '  await time.delay(1s)',
    '  describe(lease)',
  ].join('\n'),
);

/** A host that leases by name, recording every lease it is told to release. */
function leasingHost(): { readonly host: HostExterns; readonly released: unknown[] } {
  const released: unknown[] = [];
  return {
    host: {
      'main.open(String)': ([name]) => ({ id: name }),
      'main.describe(main.Lease)': ([lease]) => (lease as { id: string }).id,
      'main.release(main.Lease)': ([lease]) => {
        released.push(lease);
        return null;
      },
      'main.ready()': () => false,
    },
    released,
  };
}

const terminated = compiledText(
  [
    'extern shared struct Lease',
    '',
    'extern fn open(name: String) -> Lease',
    'extern fn describe(lease: Lease) -> String',
    'extern fn release(lease: Lease)',
    'extern fn ready() -> Bool',
    '',
    'fn dispose(self: Lease):',
    '  release(self)',
    '',
    "import * as time from 'time'\nimport * as runtime from 'runtime'\nlive async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String:",
    '  const first = open("plain")',
    '  const second = open("refusing")',
    '  await time.delay(1s)',
    '  if not ready():',
    '    panic("refused")',
    '  describe(first) + describe(second)',
  ].join('\n'),
);

describe('a disposable host type', () => {
  it('keeps what the host gave across commits, and tells the host once nothing holds it', async () => {
    const { host, released } = leasingHost();
    const test = testRuntime({ host });
    const started = test.startInstance(leasing, 'l');
    expect(started.state).toMatchObject({ kind: 'waiting' });
    expect(released).toEqual([]);
    expect(await runToEnd(test, 'l', started)).toEqual({ kind: 'finished', outcome: 'a' });
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
    const test = testRuntime({ host: refusing });
    const started = test.startInstance(terminated, 't');
    expect(await runToEnd(test, 't', started)).toMatchObject({ kind: 'panicked' });
    expect(released).toEqual([]);
    expect(await test.runtime.terminate('t')).toEqual({
      state: { kind: 'terminated', message: 'refused', trace: expect.any(String) },
      spawned: [],
      answered: [],
      logs: [],
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
    const program = compiledText(
      [
        'extern shared struct Lease',
        'extern fn open(name: String) -> Lease',
        'extern fn dispose(self: Lease)',
        'import * as runtime from \'runtime\'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): { const lease = open("b"); 1 }',
      ].join('\n'),
    );
    const test = testRuntime({ host });
    const started = test.startInstance(program, 'h');
    expect(await runToEnd(test, 'h', started)).toEqual({ kind: 'finished', outcome: 1n });
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
    const program = compiledText(
      [
        "import Revertible from 'inbox'",
        "import Encodable from 'json'\nimport * as runtime from 'runtime'\nimport * as time from 'time'",
        '',
        'extern sendable struct Queue<T is Sendable>',
        'extern shared struct Sent',
        'extern fn dispose(self: Sent)',
        'extern fn _sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Sent',
        'extern fn announcements(user: String) -> Queue<String>',
        '',
        'ista fn sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Revertible<T>:',
        '  Revertible.holding(_sendRevertible(self, msg))',
        '',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  hold _ = announcements("ann").sendRevertible("hello")',
        '  await time.delay(1s)',
        '  1',
      ].join('\n'),
    );
    const test = testRuntime({ host });
    const started = test.startInstance(program, 'r');
    expect(calls).toEqual([['send', { queue: 'ann' }, 'hello']]);
    expect(await runToEnd(test, 'r', started)).toEqual({ kind: 'finished', outcome: 1n });
    expect(calls.at(-1)).toEqual(['retract', { message: 7n }]);
  });
});
