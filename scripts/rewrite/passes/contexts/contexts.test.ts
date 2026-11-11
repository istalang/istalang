/**
 * The contexts pass on hand-picked sources: an `ista async fn main` moved into a context run by a
 * live `main`, reaching `runtime` by the source's own import or one it adds, and nothing else.
 */

import { describe, expect, it } from 'vitest';
import { applyEdits } from '../../edits.ts';
import { readIsta } from '../../pass.ts';
import { contexts } from './index.ts';

function rewritten(text: string): string {
  const rewrites = contexts(readIsta('main.ista', text));
  return applyEdits(
    text,
    rewrites.flatMap(({ edits }) => edits),
  );
}

describe('contexts', () => {
  it.each([
    ['live async fn main() -> Int: 1', 'live async fn main() -> Int: 1'],
    [
      "import * as rt from 'runtime'\nista async fn main() -> Int:\n  await rt.commit()\n  1\n",
      "import * as rt from 'runtime'\nlive async fn main() -> Int: await rt.run(rt.id()) _main()\nista async fn _main() -> Int:\n  await rt.commit()\n  1\n",
    ],
    [
      "import * as time from 'time'\nista async fn main():\n  await time.delay(1s)",
      "import * as time from 'time'\nimport * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():\n  await time.delay(1s)",
    ],
    [
      '# a comment\nista async fn main() -> Int: 1',
      "# a comment\nimport * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: 1",
    ],
    [
      'ista async fn main() -> Int: 1\nista fn again() -> Future<Int, "ista">: main()',
      'ista async fn main() -> Int: 1\nista fn again() -> Future<Int, "ista">: main()',
    ],
    [
      'ista async fn main() -> Int: await runtime()\nista async fn runtime() -> Int: 1',
      'ista async fn main() -> Int: await runtime()\nista async fn runtime() -> Int: 1',
    ],
  ])('%j becomes %j', (before, after) => {
    expect(rewritten(before)).toBe(after);
  });
});
