/**
 * The runtimes live code opens over the host's store (§9, open-runtimes.ts): opening one resumes
 * the instances stored there that haven't ended, which run on while the live code runs.
 */

import { describe, expect, it } from 'vitest';
import { compiledEncoded } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import type { HostExterns } from '../boundary/host-natives.ts';
import { recordingStore, startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { memoryStore } from '../store.ts';

/**
 * A program whose first run leaves `o/1/1` waiting on a timer as it ends, and whose second opens a
 * runtime and waits past that timer.
 */
const resuming = compiledEncoded(
  lines(
    "import * as time from 'time'",
    "import * as runtime from 'runtime'",
    'extern fn phase() -> Int',
    'extern fn note(text: String)',
    'ista async fn later():',
    '  await time.delay(1s)',
    '  note("resumed")',
    'ista async fn begin() -> Int:',
    '  spawn later()',
    '  0',
    'ista async fn idle() -> Int:',
    '  await time.delay(2s)',
    '  1',
    'live async fn main() -> Int:',
    '  if phase() == 1:',
    '    return await runtime.run("o/1") begin()',
    '  await runtime.run("o/2") idle()',
  ),
);

describe('a runtime opened over a store', () => {
  it("resumes the instances stored there that haven't ended", async () => {
    const store = memoryStore();
    const notes: string[] = [];
    let phase = 1n;
    const host: HostExterns = {
      'main.phase()': () => phase,
      'main.note(String)': ([text]) => {
        notes.push(String(text));
        return null;
      },
    };
    const first = testRuntime({ host, store: recordingStore(store) });
    expect(await startToEnd(first, resuming)).toEqual({ kind: 'finished', outcome: '0' });
    expect(notes).toEqual([]);

    phase = 2n;
    const second = testRuntime({ host, store: recordingStore(store) });
    expect(await startToEnd(second, resuming)).toEqual({ kind: 'finished', outcome: '1' });
    expect(notes).toEqual(['resumed']);
    expect(second.runtime.inspect('o/1/1').state).toMatchObject({ kind: 'finished' });
  });
});
