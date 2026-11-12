/**
 * The oracle of static lifetimes (oracle.test-kit.ts) sees the cycles that reach a disposable and
 * only those, over programs shaped as the design's acceptance examples
 * (docs/work/static-lifetimes/design.md §12): what holds what is the runtime's, but for a call's
 * future holding its call and a wait's chain holding nothing.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { cyclicOracle } from './oracle.test-kit.ts';

const declarations = [
  "import * as runtime from 'runtime'",
  'shared struct Lease:',
  '  partner: Lease? = none',
  'fn dispose(self: Lease): ()',
  'shared struct Plain:',
  '  next: Plain? = none',
  '  lease: Lease? = none',
  '  call: Future<Int, "ista">? = none',
  'ista async fn holding(plain: Plain) -> Int:',
  '  await runtime.commit()',
  '  _ = plain->next',
  '  0',
  'shared struct Kept:',
  '  resolver: Resolver<Int, "ista">? = none',
  'struct Watched:',
  '  kept: Kept',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Watched, done: Resolver<Int, "ista">):',
  '  done.onCancel(fn(): { _ = self.kept; () })',
  '  self.kept->resolver = done',
  '  holding(new Plain{}).onAwait(done)',
];

/** How running `body` in a block of `_main` ended, and whether it made a cycle the oracle sees. */
async function seesCycle(...body: string[]) {
  const oracle = cyclicOracle();
  const text = compiledText(
    [
      ...declarations,
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
      'ista async fn _main() -> Int:',
      '  if true:',
      ...body.map((line) => `    ${line}`),
      '  await runtime.commit()',
      '  await runtime.commit()',
      '  0',
    ].join('\n'),
  );
  const ended = await startToEnd(testRuntime({ heapCheck: oracle.heapCheck }), text);
  return { ended, seen: oracle.asExpected() };
}

const finished = { kind: 'finished', outcome: '0' };

describe('the oracle of static lifetimes', () => {
  it.each([
    [
      'disposables holding each other',
      ['const a = new Lease{}', 'const b = new Lease{}', 'a->partner = b', 'b->partner = a'],
    ],
    ['a disposable holding itself', ['const a = new Lease{}', 'a->partner = a']],
    [
      'a cycle of plain objects holding a disposable',
      ['const a = new Plain{lease: new Lease{}}', 'const b = new Plain{next: a}', 'a->next = b'],
    ],
    [
      "a call holding what holds the call's future",
      ['const plain = new Plain{}', 'plain->call = holding(plain)'],
    ],
    [
      'a callback holding the future it is registered on',
      [
        'const call = holding(new Plain{})',
        'call.onAwait(Resolver.of(fn(_: Int): { _ = call; () }))',
      ],
    ],
  ])('sees %s', async (_case, body) => {
    expect(await seesCycle(...body)).toEqual({ ended: finished, seen: true });
  });

  it.each([
    [
      'a cycle of objects reaching no disposable',
      ['const a = new Plain{}', 'const b = new Plain{next: a}', 'a->next = b'],
    ],
    [
      "a call holding what doesn't hold its future",
      ['const plain = new Plain{}', 'const call = holding(plain)', 'drop call'],
    ],
    [
      "a wait's resolver whose onCancel holds what holds it, which goes with the wait",
      ['_ = await Watched{kept: new Kept{}}'],
    ],
  ])('sees no cycle in %s', async (_case, body) => {
    expect(await seesCycle(...body)).toEqual({ ended: finished, seen: false });
  });
});
