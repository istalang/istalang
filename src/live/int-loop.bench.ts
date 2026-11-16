/**
 * An `Int` loop compiled to JavaScript against the same loop written by hand over bigint, the gate
 * on primitive operations (docs/work/ir-first/design.md, "Perf gates": within 2×), measured with
 * `npm run bench` and kept out of `npm run verify`. What is timed is the build
 * (built-program.test-kit.ts).
 */

import { test as it } from 'vitest';
import { compiledEncoded } from '../compiler/compile.test-kit.ts';
import { builtProgram } from './built-program.test-kit.ts';

const iterations = 100_000;
/** A prime the loop's total stays below, so its arithmetic stays on small ints. */
const modulus = 1_000_003n;

const compiled = compiledEncoded(
  [
    'fn mix(n: Int) -> Int:',
    '  let total = 0',
    '  let i = 0',
    '  while i < n:',
    `    total = (total + i * i) % ${modulus}`,
    '    i += 1',
    '  total',
    '',
    'live async fn main() -> Int: 0',
  ].join('\n'),
);

/** The loop as written by hand over the same representation. */
function mix(n: bigint): bigint {
  let total = 0n;
  let i = 0n;
  while (i < n) {
    total = (total + i * i) % modulus;
    i += 1n;
  }
  return total;
}

it(`an Int loop of ${iterations} iterations`, async ({ bench, expect }) => {
  const built = await builtProgram(compiled);
  const start = { function: 'main.mix(Int)', arguments: [iterations] };
  expect(await built.start(start)).toMatchObject({
    kind: 'finished',
    text: String(mix(BigInt(iterations))),
  });
  await bench('compiled', async () => {
    await built.start(start);
  }).run({ time: 3000, warmupIterations: 10 });
  await bench('by hand', () => {
    mix(BigInt(iterations));
  }).run({ time: 3000, warmupIterations: 10 });
});
