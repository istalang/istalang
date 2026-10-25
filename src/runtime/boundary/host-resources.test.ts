/**
 * A host type a `dispose` makes disposable (§3.6, §7), on programs the real compiler builds: each
 * value arrives from the host as a resource holding the host's JSON, lives in the instance across
 * commits like any other object, leaves to the host as that JSON, and is disposed by its `dispose`
 * once nothing holds it, which tells the host.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { runToEnd, testRuntime } from '../runtime.test-kit.ts';
import type { HostCall, HostExterns } from './host-natives.ts';

const leasing = compiledText(
  [
    'extern struct Lease',
    '',
    'extern fn open(name: string) -> Lease',
    'extern fn describe(lease: Lease) -> string',
    'extern fn release(lease: Lease)',
    'extern fn approval() -> Future<string>',
    '',
    'fn dispose(self: Lease):',
    '  release(self)',
    '',
    'async fn main() -> Future<string>:',
    '  const lease = open("a")',
    '  const note = await approval()',
    '  note + describe(lease)',
  ].join('\n'),
);

/** A host that leases by name, recording every lease it is told to release. */
function leasingHost(): { readonly host: HostExterns; readonly released: unknown[] } {
  const released: unknown[] = [];
  return {
    host: {
      'main.open(string)': ([name]) => ({ id: name }),
      'main.describe(main.Lease)': ([lease]) => (lease as { id: string }).id,
      'main.release(main.Lease)': ([lease]) => {
        released.push(lease);
        return null;
      },
      'main.approval()': (_, call: HostCall) => call.pending('approval'),
    },
    released,
  };
}

const terminated = compiledText(
  [
    'extern struct Lease',
    '',
    'extern fn open(name: string) -> Lease',
    'extern fn describe(lease: Lease) -> string',
    'extern fn release(lease: Lease)',
    'extern fn approval() -> Future<bool>',
    '',
    'fn dispose(self: Lease):',
    '  release(self)',
    '',
    'async fn main() -> Future<string>:',
    '  const first = open("plain")',
    '  const second = open("refusing")',
    '  if not await approval():',
    '    panic("refused")',
    '  describe(first) + describe(second)',
  ].join('\n'),
);

describe('a disposable host type', () => {
  it('keeps what the host gave across commits, and tells the host once nothing holds it', () => {
    const { host, released } = leasingHost();
    const test = testRuntime({ host });
    const started = test.runtime.deploy(leasing).start('l');
    expect(started.state).toEqual({ kind: 'waiting', until: undefined });
    expect(released).toEqual([]);
    const filled = test.runtime.fill('l', 'approval', 'leased ');
    expect(runToEnd(test, 'l', filled)).toEqual({ kind: 'finished', outcome: '"leased a"' });
    expect(released).toEqual([{ id: 'a' }]);
  });

  it('is disposed when its panicked instance is terminated, even after another disposal panics', () => {
    const { host, released } = leasingHost();
    const refusing: HostExterns = {
      ...host,
      'main.release(main.Lease)': ([lease]) => {
        released.push(lease);
        return (lease as { id: string }).id === 'refusing' ? 'not unit' : null;
      },
    };
    const test = testRuntime({ host: refusing });
    test.runtime.deploy(terminated).start('t');
    expect(test.runtime.fill('t', 'approval', false).state).toMatchObject({ kind: 'panicked' });
    expect(released).toEqual([]);
    expect(test.runtime.terminate('t')).toEqual({ state: { kind: 'terminated' }, spawned: [] });
    expect(released).toEqual([{ id: 'refusing' }, { id: 'plain' }]);
  });

  it("is disposed by its host when the host implements its 'dispose'", () => {
    const disposed: unknown[] = [];
    const host: HostExterns = {
      'main.open(string)': ([name]) => ({ id: name }),
      'main.dispose(main.Lease)': ([lease]) => {
        disposed.push(lease);
        return null;
      },
    };
    const program = compiledText(
      [
        'extern struct Lease',
        'extern fn open(name: string) -> Lease',
        'extern fn dispose(self: Lease)',
        'async fn main(): { const lease = open("b"); 1 }',
      ].join('\n'),
    );
    const test = testRuntime({ host });
    const started = test.runtime.deploy(program).start('h');
    expect(runToEnd(test, 'h', started)).toEqual({ kind: 'finished', outcome: '1' });
    expect(disposed).toEqual([{ id: 'b' }]);
  });
});
