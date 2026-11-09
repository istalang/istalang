/**
 * Log records reach the host only with their segment's commit (spec §3.8 `log`, §9), on programs
 * the real compiler builds: a committed segment reports its records in order, while a segment
 * that is discarded, by a panic or by `crashEveryAwait`'s first run, reports none.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { testRuntime } from '../runtime.test-kit.ts';

/** `main` logging in two segments, then panicking in a third when `fails`. */
function loggingMain(fails: boolean): string {
  return [
    "import * as log from 'log'",
    "import * as runtime from 'runtime'",
    'async fn main() -> Future<Int>:',
    '  log.info("first", struct{n: 1})',
    '  await runtime.commit()',
    '  log.warn("second")',
    '  await runtime.commit()',
    '  log.error("lost")',
    fails ? '  panic("stop")' : '  3',
  ].join('\n');
}

const messagesOf = (logs: readonly { readonly message: string }[]) =>
  logs.map(({ message }) => message);

describe('log records', () => {
  it('reach the host with their segments, stamped with the instance and the segment time', async () => {
    const { runtime, clock } = testRuntime();
    clock.set(1000n);
    const advanced = await runtime.deploy(compiledText(loggingMain(false))).start('main');
    expect(advanced.logs).toEqual([
      { instance: 'main', time: 1000n, level: 'info', message: 'first', fields: { n: 1n } },
      { instance: 'main', time: 1000n, level: 'warn', message: 'second', fields: {} },
      { instance: 'main', time: 1000n, level: 'error', message: 'lost', fields: {} },
    ]);
  });

  it('are lost with a segment that panics, and kept with those that committed before it', async () => {
    const { runtime } = testRuntime();
    const advanced = await runtime.deploy(compiledText(loggingMain(true))).start('main');
    expect(advanced.state.kind).toBe('panicked');
    expect(messagesOf(advanced.logs)).toEqual(['first', 'second']);
  });

  it("are reported once when crashEveryAwait discards each segment's first run", async () => {
    const { runtime } = testRuntime();
    const program = runtime.deploy(compiledText(loggingMain(false)));
    const advanced = await program.start('main', { crashEveryAwait: true });
    expect(advanced.state.kind).toBe('finished');
    expect(messagesOf(advanced.logs)).toEqual(['first', 'second', 'lost']);
  });
});
