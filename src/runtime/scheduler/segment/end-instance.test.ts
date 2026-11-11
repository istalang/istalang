/**
 * Terminating a panicked instance (§3.12) disposes what it holds (§7), on programs the real
 * compiler builds: its root stops, so a call it held is disposed as any released call is, its
 * `disposing()` case running before it stops.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import type { HostExterns } from '../../boundary/host-natives.ts';
import { runToEnd, testRuntime } from '../../runtime.test-kit.ts';

const program = compiledText(
  [
    'extern fn note(text: String)',
    'extern fn ready() -> Bool',
    '',
    'ista async fn child() -> Int:',
    '  await select:',
    '    case child.disposing():',
    '      note("child cleaned up")',
    '      0',
    '    case time.delay(1d):',
    '      1',
    '',
    "import * as time from 'time'\nimport * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
    '  const running = child()',
    '  await time.delay(1s)',
    '  if not ready():',
    '    panic("refused")',
    '  await running',
  ].join('\n'),
);

describe('terminating an instance', () => {
  it("runs the cleanup of a call its root held, as that call's disposal", async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
      'main.ready()': () => false,
    };
    const test = testRuntime({ host });
    const started = test.startInstance(program, 't');
    expect(await runToEnd(test, 't', started)).toMatchObject({ kind: 'panicked' });
    expect(notes).toEqual([]);
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['child cleaned up']);
  });

  it("runs the cleanup of a call held by a panicked context's invocation when the context is terminated (§3.12, §7, §9)", async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
    };
    const test = testRuntime({ host });
    const deployed = test.runtime.deploy(
      compiledText(
        [
          'extern fn note(text: String)',
          '',
          'ista async fn child() -> Int:',
          '  await select:',
          '    case child.disposing():',
          '      note("child cleaned up")',
          '      0',
          '    case time.delay(1d):',
          '      1',
          '',
          "import * as runtime from 'runtime'\nimport * as time from 'time'",
          'live async fn main() -> Int: await runtime.run("t") _main()',
          'ista async fn _main() -> Int:',
          '  const running = child()',
          '  await runtime.commit()',
          '  panic("refused")',
          '  await running',
        ].join('\n'),
      ),
    );
    expect((await deployed.start('run')).state).toMatchObject({
      kind: 'panicked',
      message: 'refused',
    });
    expect(test.runtime.inspect('t').state).toMatchObject({ kind: 'panicked' });
    expect(notes).toEqual([]);
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['child cleaned up']);
  });

  it('lets go of a disposal that panics before its call runs, the rest going on', async () => {
    const notes: unknown[] = [];
    const host: HostExterns = {
      'main.note(String)': ([text]) => {
        notes.push(text);
        return null;
      },
    };
    const test = testRuntime({ host });
    const dropping = compiledText(
      [
        'extern fn note(text: String)',
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'struct Dropper:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Dropper, done: Resolver<Int, "ista">): ()',
        'struct Panicking:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Panicking, done: Resolver<Int, "ista">) -> Unit: panic("in onAwait")',
        'shared struct Probe { name: String }',
        'ista fn dispose(self: Probe):',
        '  const got = select:',
        '    case Dropper: 1',
        '    else: 0',
        '  note("probed " + self->name)',
        'shared struct CrashProbe { name: String }',
        'ista fn dispose(self: CrashProbe):',
        '  const got = select:',
        '    case Panicking: 1',
        '    else: 0',
        '  note("crashed " + self->name)',
        'shared struct Lease { name: String }',
        'fn dispose(self: Lease): note("disposed " + self->name)',
        'ista async fn boom():',
        '  await time.delay(5ms)',
        '  panic("boom")',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  const crash = new CrashProbe{name: "crash"}',
        '  const lease = new Lease{name: "lease"}',
        '  const probe = new Probe{name: "probe"}',
        '  hold _ = boom()',
        '  await time.delay(1d)',
        '  0',
      ].join('\n'),
    );
    const started = test.startInstance(dropping, 't');
    expect(await runToEnd(test, 't', started)).toMatchObject({ kind: 'panicked', message: 'boom' });
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['disposed lease']);
  });
});
