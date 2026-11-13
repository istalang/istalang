/**
 * Building a collection one item at a time (docs/work/tracker.md, P2), measured with `npm run bench`
 * and kept out of `npm run verify`, as the scheduler's is (scheduler/wake.bench.ts): a
 * comprehension, map inserts and a spread through a cursor, each at two sizes. Changing a value in
 * place where nothing else holds it (in-place.ts) makes each linear, so the larger size takes about
 * twice the smaller's time.
 */

import { test as it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { noHeapCheck } from '../scheduler/loaded-definition.ts';

/** A runtime as a host runs one, its heaps unchecked by the test runtime's oracle. */
const hosted = () => testRuntime({ heapCheck: noHeapCheck });

/** A program whose `main` builds what `body` builds from `n` and gives its size. */
function program(body: string): string {
  return compiledText(`
import * as runtime from 'runtime'

live async fn main() -> Int: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Int:
${body}
`);
}

const workloads = {
  comprehension: (n: number) => `  [for i in 0..${n}: i].length()`,
  'map inserts': (n: number) => `  let m: Map<Int, Int> = [:]
  for i in 0..${n}:
    m[i] = i
  m.size()`,
  'spread of a range': (n: number) => `  [...0..${n}].length()`,
} as const;

const sizes = { comprehension: 20_000, 'map inserts': 5000, 'spread of a range': 20_000 } as const;

for (const [name, body] of Object.entries(workloads)) {
  const size = sizes[name as keyof typeof sizes];
  for (const n of [size, 2 * size]) {
    const text = program(body(n));
    it(`${name} of ${n}`, async ({ bench, expect }) => {
      expect(await startToEnd(hosted(), text)).toEqual({ kind: 'finished', outcome: String(n) });
      await bench('start to end', async () => {
        await startToEnd(hosted(), text);
      }).run({ time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 });
    });
  }
}
