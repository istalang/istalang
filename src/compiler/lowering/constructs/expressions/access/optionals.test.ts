/**
 * `x!` as it runs (§4): the value inside an optional, a whole chain before it unwrapped, and a
 * panic on none whose trace starts where it was written. Every use is a warning, so the corpus,
 * whose programs run without one, can't hold these.
 */

import { describe, expect, it } from 'vitest';
import { startToEnd, testRuntime } from '../../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../../compile.test-kit.ts';

const shapes = ['struct Inner { code: Int }', 'struct Outer { inner: Inner? }'];

/** The frames of a panic in `_main`, at the `!` on the program's seventh line, and the live `main` above it. */
const unwrapFrame = /^at \S*main\._main \(\S+:7:3\)\nat \S*main\.main\.lambda@\S+ \(\S+\)$/u;

/** How `main`, giving a `result` with `body`, ends. */
async function ended(result: string, body: string) {
  const program = [
    ...shapes,
    `import * as runtime from 'runtime'
live async fn main() -> ${result}: await runtime.run(runtime.id()) _main()
ista async fn _main() -> ${result}:`,
    `  ${body}`,
  ].join('\n');
  return await startToEnd(testRuntime(), compiledText(program));
}

describe("'!'", () => {
  it('gives the value inside an optional, unwrapping a whole chain', async () => {
    const state = await ended(
      '(Int, Int)',
      'const outer: Outer? = Outer{Inner{7}}\n  const maybe: Int? = 3\n  (maybe! + 1, outer?.inner?.code!)',
    );
    expect(state).toMatchObject({ kind: 'finished', outcome: '[4,7]' });
  });

  it('panics on none, where it was written', async () => {
    const state = await ended('Int', 'const missing: Int? = none\n  missing! + 1');
    expect(state).toMatchObject({ kind: 'panicked', message: 'Force-unwrapped none.' });
    expect(state.kind === 'panicked' ? state.trace : '').toMatch(unwrapFrame);
  });

  it("panics through the prelude's panic, whatever a local one shadows (§3.4)", async () => {
    const local = 'const panic = fn(message: String) -> Int: message.length()';
    const state = await ended('Int', `${local}\n  const missing: Int? = none\n  missing! + 1`);
    expect(state).toMatchObject({ kind: 'panicked', message: 'Force-unwrapped none.' });
  });
});
