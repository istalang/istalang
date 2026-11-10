/**
 * Host operation speed, measured with `npm run bench` and kept out of `npm run verify`, as the
 * scheduler's is (scheduler/wake.bench.ts).
 *
 * Every operation on a stored instance reads the Definition its snapshot names from the store. A
 * runtime reads, validates and binds each Definition text once, so inspecting a finished instance
 * costs reading its snapshot, not the whole program again. The program sorts with the prelude and
 * formats with `strings`, so its Definition carries a realistic share of the std modules.
 */

import { test as it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { testRuntime } from '../runtime.test-kit.ts';

const text = compiledText(`
import * as strings from 'strings'

ista async fn main() -> String:
  let items = [5, 3, 9, 1]
  items.sort()
  strings.format("{} items, first {}", items.length().toString(), items[0].toString())
`);

it('inspect a finished instance', async ({ bench, expect }) => {
  const { runtime } = testRuntime();
  await runtime.deploy(text).start('finished');
  expect(runtime.inspect('finished').state.kind).toBe('finished');
  await bench('inspect', () => {
    runtime.inspect('finished');
  }).run({ time: 2000, warmupIterations: 20 });
});
