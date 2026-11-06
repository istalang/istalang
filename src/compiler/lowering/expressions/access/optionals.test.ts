/**
 * `x!` as it runs (§4): the value inside an optional, a whole chain before it unwrapped, and a
 * panic on none whose trace starts where it was written. Every use is a warning, so the corpus,
 * whose programs run without one, can't hold these.
 */

import { describe, expect, it } from 'vitest';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';

const shapes = ['struct Inner { code: Int }', 'struct Outer { inner: Inner? }'];

/** The one frame of a panic in `main`, at the `!` on the program's fifth line. */
const unwrapFrame = /^at \S*main \(\S+:5:3\)$/u;

/** How `main`, giving a `result` with `body`, ends. */
function ended(result: string, body: string) {
  const program = [...shapes, `async fn main() -> Future<${result}>:`, `  ${body}`].join('\n');
  return startToEnd(testRuntime(), compiledText(program));
}

describe("'!'", () => {
  it('gives the value inside an optional, unwrapping a whole chain', () => {
    const state = ended(
      '(Int, Int)',
      'const outer: Outer? = Outer{Inner{7}}\n  const maybe: Int? = 3\n  (maybe! + 1, outer?.inner?.code!)',
    );
    expect(state).toMatchObject({ kind: 'finished', outcome: '[4,7]' });
  });

  it('panics on none, where it was written', () => {
    const state = ended('Int', 'const missing: Int? = none\n  missing! + 1');
    expect(state).toMatchObject({ kind: 'panicked', message: 'Force-unwrapped none.' });
    expect(state.kind === 'panicked' ? state.trace : '').toMatch(unwrapFrame);
  });
});
