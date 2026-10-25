/**
 * Host handles (§3.6), on programs the real compiler builds: an extern returning a `Shared` of a
 * struct with only function fields gets JSON naming the handle from its host, and each function
 * calls the host's extern keyed after it, with that JSON first. The inbox module's `Revertible<T>`
 * is one, so a host's queue is told when a revertible send is released.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostCall, HostExterns } from './host-natives.ts';

const queueKey = 'main.sendRevertible(main.Queue<T>, T)';

const revertible = compiledText(
  [
    "import Revertible from 'inbox'",
    '',
    'extern sendable struct Queue<T is Sendable>',
    'extern fn sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Revertible<T>',
    'extern fn announcements(user: string) -> Queue<string>',
    'extern fn gate() -> Future<unit>',
    '',
    'async fn main() -> Future<int>:',
    '  fn _ = announcements("ann").sendRevertible("hello")',
    '  await gate()',
    '  1',
  ].join('\n'),
);

const leasing = compiledText(
  [
    'struct LeaseOps:',
    '  renew: fn(int) -> bool',
    '  owner: fn() -> string',
    '',
    'extern fn lease(name: string) -> Shared<LeaseOps>',
    '',
    'async fn main() -> Future<string>:',
    '  const ops = lease("a")',
    '  const renewed = ops$.renew(5)',
    '  ops$.owner() + " " + string(renewed)',
  ].join('\n'),
);

describe('a host handle', () => {
  it("tells the host's queue, by the JSON it named the send with, once a revertible send is released", () => {
    const calls: unknown[][] = [];
    const host: HostExterns = {
      'main.announcements(string)': ([user]) => ({ queue: user }),
      [queueKey]: (given) => {
        calls.push(['send', ...given]);
        return { message: 7n };
      },
      [`${queueKey}.retract`]: (given) => {
        calls.push(['retract', ...given]);
        return null;
      },
      'main.gate()': (_, call: HostCall) => call.pending('gate'),
    };
    const test = testRuntime({ host });
    test.runtime.deploy(revertible).start('r');
    expect(calls).toEqual([['send', { queue: 'ann' }, 'hello']]);
    const filled = test.runtime.fill('r', 'gate', null);
    expect(runToEnd(test, 'r', filled)).toEqual({ kind: 'finished', outcome: '1' });
    expect(calls.at(-1)).toEqual(['retract', { message: 7n }]);
  });

  it('calls its functions on the host with their arguments, reading back what they give', () => {
    const host: HostExterns = {
      'main.lease(string)': ([name]) => `lease ${String(name)}`,
      'main.lease(string).renew': ([lease, minutes]) => lease === 'lease a' && minutes === 5n,
      'main.lease(string).owner': ([lease]) => `owner of ${String(lease)}`,
    };
    const test = testRuntime({ host });
    const started = test.runtime.deploy(leasing).start('l');
    expect(runToEnd(test, 'l', started)).toEqual({
      kind: 'finished',
      outcome: '"owner of lease a true"',
    });
  });
});
