/**
 * Terminating a panicked instance (§3.12) disposes what it holds (§7), on programs the real
 * compiler builds: its root stops, so a call it held is disposed as any released call is, its
 * `disposing()` case running before it stops.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import type { HostCall, HostExterns } from '../../boundary/host-natives.ts';
import { testRuntime } from '../../runtime.test-kit.ts';

const program = compiledText(
  [
    'extern fn note(text: String)',
    'extern ista fn approval() -> Future<Bool, "ista">',
    'extern ista fn gate() -> Future<Int, "ista">',
    '',
    'ista async fn child() -> Int:',
    '  await select:',
    '    case child.disposing():',
    '      note("child cleaned up")',
    '      0',
    '    case gate():',
    '      1',
    '',
    "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
    '  const running = child()',
    '  if not await approval():',
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
      'main.approval()': (_, call: HostCall) => call.pending('approval'),
      'main.gate()': (_, call: HostCall) => call.pending('gate'),
    };
    const test = testRuntime({ host });
    test.startInstance(program, 't');
    expect((await test.runtime.fill('t', 'approval', false)).state).toMatchObject({
      kind: 'panicked',
    });
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
      'main.gate()': (_, call: HostCall) => call.pending('gate'),
    };
    const test = testRuntime({ host });
    const deployed = test.runtime.deploy(
      compiledText(
        [
          'extern fn note(text: String)',
          'extern ista fn gate() -> Future<Int, "ista">',
          '',
          'ista async fn child() -> Int:',
          '  await select:',
          '    case child.disposing():',
          '      note("child cleaned up")',
          '      0',
          '    case gate():',
          '      1',
          '',
          "import * as runtime from 'runtime'",
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
});
