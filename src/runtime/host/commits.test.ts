/**
 * Committing a segment (§5, commits.ts): a panicked segment never happened, so what it spawned
 * never starts and its log records never reach the host, while the call waiting on it hears its
 * panic.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import type { LogRecord } from '../instance-state.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';

describe('a panicked segment', () => {
  it('lets out its end alone: no spawn, no log record', async () => {
    const logs: LogRecord[] = [];
    const test = testRuntime({
      reports: { logs: (records) => logs.push(...records), panicked: () => undefined },
    });
    const text = compiledText(
      lines(
        "import * as log from 'log'",
        "import * as runtime from 'runtime'",
        'ista async fn child() -> Int: 1',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
        'ista async fn _main() -> Int:',
        '  log.info("lost")',
        '  spawn child()',
        '  panic("stop")',
      ),
    );
    const ended = await startToEnd(test, text, { instance: 'x' });
    expect(ended).toMatchObject({ kind: 'panicked', message: expect.stringContaining('stop') });
    expect(() => test.runtime.inspect('x/1')).toThrow("The store holds no instance 'x/1'.");
    expect(logs).toEqual([]);
  });
});
