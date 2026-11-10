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
    'extern fn approval() -> Future<Bool, "ista">',
    'extern fn gate() -> Future<Int, "ista">',
    '',
    'ista async fn child() -> Int:',
    '  await select:',
    '    case child.disposing():',
    '      note("child cleaned up")',
    '      0',
    '    case gate():',
    '      1',
    '',
    'async fn main() -> Int:',
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
    await test.runtime.deploy(program).start('t');
    expect((await test.runtime.fill('t', 'approval', false)).state).toMatchObject({
      kind: 'panicked',
    });
    expect(notes).toEqual([]);
    expect((await test.runtime.terminate('t')).state).toMatchObject({ kind: 'terminated' });
    expect(notes).toEqual(['child cleaned up']);
  });
});
