/**
 * Executions (executions.ts) obey the call rule (foundation/language/call-rule.ts): an instance
 * starts async code of its own kind alone, the one place a Definition's marks are checked as code
 * runs.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { lines } from '../../compiler/parser/parse.test-kit.ts';
import { withModeChanged } from '../../definition/definition.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';

describe('an execution started', () => {
  it('is code of its instance’s kind: a live run refuses to start ista code', async () => {
    const text = compiledText(
      lines('live async fn helper() -> Int: 1', 'live async fn main() -> Int: await helper()'),
    );
    expect(await startToEnd(testRuntime(), text)).toEqual({ kind: 'finished', outcome: '1' });
    await expect(
      startToEnd(
        testRuntime(),
        withModeChanged(text, { name: 'main.helper', from: 'live', to: 'ista' }),
      ),
    ).rejects.toThrow('A live instance starts ista code, which the call rule refuses.');
  });
});
