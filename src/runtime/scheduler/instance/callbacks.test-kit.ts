/**
 * What the tests of resolvers calling back share: somewhere to see a callback's effect, a future
 * that arrives later, an awaitable that keeps its resolver and sees it cancelled, and `main` run
 * to its end over them.
 */

import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';

/** What every scenario uses: somewhere to see a callback's effect, and a future that arrives later. */
export const shared = [
  "import * as futures from 'futures'",
  "import * as runtime from 'runtime'",
  "import * as time from 'time'",
  'shared struct Seen:',
  '  value: Int',
  'K fn see<K in Persistence>(seen: Seen, value: Int): seen->value = value',
  'ista async fn later(value: Int) -> Int:',
  '  await runtime.commit()',
  '  value',
];

/** An awaitable on `later(1)` that has its resolver's cancelling seen as -1, and keeps it. */
export const watched = [
  'shared struct Kept:',
  '  resolver: Resolver<Int, "ista">? = none',
  'struct Watched:',
  '  seen: Seen',
  '  kept: Kept',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Watched, done: Resolver<Int, "ista">):',
  '  done.onCancel(fn(): see(self.seen, -1))',
  '  self.kept->resolver = done',
  '  later(1).onAwait(done)',
];

/** `main`, given every line of `lines`, run to its end, crashing at every await or not. */
export function ended(lines: readonly string[], crashEveryAwait = false) {
  return startToEnd(testRuntime(), compiledText([...shared, ...watched, ...lines].join('\n')), {
    crashEveryAwait,
  });
}
