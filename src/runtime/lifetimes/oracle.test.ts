/**
 * The oracle of static lifetimes (oracle.test-kit.ts) sees the cycles that reach a disposable and
 * only those, over programs shaped as the design's acceptance examples
 * (docs/work/done/static-lifetimes/design.md §12): what holds what is the runtime's, but for a call's
 * future holding its call, and a wait holding what its chain is registered on rather than the
 * chain. It sees a cycle whether something lets go of it or it is undone first, and stops the run
 * there: counting never disposes a cycle, so what such a program does after is no one's to say.
 */

import { describe, expect, it } from 'vitest';
import { textDespiteCycles } from '../../compiler/compile.test-kit.ts';
import { handleTo } from '../../definition/values/values.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { testHeap } from '../scheduler/instance/heap.test-kit.ts';
import { oracle } from './oracle.test-kit.ts';

const declarations = [
  "import * as runtime from 'runtime'",
  "import * as time from 'time'",
  'shared struct Lease:',
  '  partner: Lease? = none',
  'fn dispose(self: Lease): ()',
  'shared struct Plain:',
  '  next: Plain? = none',
  '  lease: Lease? = none',
  '  call: Future<Int, "ista">? = none',
  '  slot: Slot<Plain>? = none',
  '  timer: Future<Unit, "ista">? = none',
  'ista async fn holding(plain: Plain) -> Int:',
  '  await runtime.commit()',
  '  _ = plain->next',
  '  0',
  'shared struct Kept:',
  '  resolver: Resolver<Int, "ista">? = none',
  'ista async fn holdingKept(kept: Kept) -> Int:',
  '  await runtime.commit()',
  '  _ = kept->resolver',
  '  0',
  '# An awaitable whose resolver is kept by what its `onCancel` callback holds.',
  'struct Watched:',
  '  kept: Kept',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Watched, done: Resolver<Int, "ista">):',
  '  done.onCancel(fn(): { _ = self.kept; () })',
  '  self.kept->resolver = done',
  '  holding(new Plain{}).onAwait(done)',
  '# An awaitable registering its resolver on a call holding what keeps the resolver.',
  'struct Keeping:',
  '  kept: Kept',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Keeping, done: Resolver<Int, "ista">):',
  '  self.kept->resolver = done',
  '  holdingKept(self.kept).onAwait(done)',
  '# An awaitable handing its box to the call it registers on, keeping it no more itself.',
  'shared struct Once:',
  '  box: Plain? = none',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Once, done: Resolver<Int, "ista">):',
  '  const box = self->box!',
  '  self->box = none',
  '  holding(box).onAwait(done)',
  'ista async fn awaiting(once: Once) -> Int: await once',
  '# An awaitable whose resolver, registered on a call, cancels into the box it takes from itself.',
  'shared struct Cancelling:',
  '  box: Plain? = none',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Cancelling, done: Resolver<Int, "ista">):',
  '  const box = self->box!',
  '  self->box = none',
  '  done.onCancel(fn(): { _ = box->next; () })',
  '  holding(new Plain{}).onAwait(done)',
  'ista async fn awaitingCancelling(cancelling: Cancelling) -> Int: await cancelling',
  'shared struct KeptPair:',
  '  resolver: Resolver<(Int, Int), "ista">? = none',
  '# An awaitable whose `Resolver.at` cancels into what keeps the resolver it decides.',
  'struct WatchedAt:',
  '  kept: KeptPair',
  '  type Mode = "ista"',
  'ista fn onAwait(self: WatchedAt, done: Resolver<(Int, Int), "ista">):',
  '  const at = Resolver.at(done, 0)',
  '  at.onCancel(fn(): { _ = self.kept; () })',
  '  self.kept->resolver = done',
  '  holding(new Plain{}).onAwait(at)',
];

/** How running `body` in `_main`, in a block of its own or not, under the oracle ended. */
function ran(body: readonly string[], inBlock: boolean) {
  const indent = inBlock ? '    ' : '  ';
  const text = textDespiteCycles(
    [
      ...declarations,
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
      'ista async fn _main() -> Int:',
      ...(inBlock ? ['  if true:'] : []),
      ...body.map((line) => `${indent}${line}`),
      '  await runtime.commit()',
      '  await runtime.commit()',
      '  0',
    ].join('\n'),
  );
  return startToEnd(testRuntime({ heapCheck: oracle }), text);
}

const finished = { kind: 'finished', outcome: '0' };

/** Each case of `cases`, run in a block of its own and not. */
const placed = (cases: readonly (readonly [string, readonly string[]])[]) =>
  cases.flatMap(([name, body]) => [
    { name, body, inBlock: true },
    { name, body, inBlock: false },
  ]);

describe('the oracle of static lifetimes', () => {
  it.each(
    placed([
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
          'const callback = Resolver.of(fn(_: Int): { _ = call; () })',
          'call.onAwait(callback)',
        ],
      ],
      [
        "a call awaiting what holds the call's future",
        ['const plain = new Plain{}', 'plain->call = awaiting(new Once{box: plain})'],
      ],
      [
        "a wait's resolver whose onCancel holds what holds it",
        ['_ = await Watched{kept: new Kept{}}'],
      ],
      [
        "a call awaiting a resolver whose onCancel holds what holds the call's future",
        [
          'const plain = new Plain{}',
          'plain->call = awaitingCancelling(new Cancelling{box: plain})',
        ],
      ],
      [
        'a slot holding what holds it',
        [
          'const slot = Slot.create<Plain>()',
          'const plain = new Plain{slot}',
          '_ = slot.put(plain)',
        ],
      ],
      [
        'a cycle of plain objects holding a pending timer',
        [
          'const a = new Plain{timer: time.delay(10s)}',
          'const b = new Plain{next: a}',
          'a->next = b',
        ],
      ],
    ]),
  )('sees $name (in a block: $inBlock)', async ({ body, inBlock }) => {
    await expect(ran(body, inBlock)).rejects.toThrow('A cycle reaching a disposable holds objects');
  });

  it.each(
    placed([
      [
        'a cycle of objects reaching no disposable',
        ['const a = new Plain{}', 'const b = new Plain{next: a}', 'a->next = b'],
      ],
      [
        "a call holding what doesn't hold its future",
        ['const plain = new Plain{}', 'const call = holding(plain)', 'drop call'],
      ],
      [
        "a wait's chain registered on a call holding what keeps its resolver",
        ['_ = await Keeping{kept: new Kept{}}'],
      ],
      [
        // A resolver doesn't hold the `Resolver.at` ones deciding it (design.md §6.3).
        'a Resolver.at whose onCancel holds what keeps the resolver it decides',
        ['_ = await WatchedAt{kept: new KeptPair{}}'],
      ],
    ]),
  )('sees no cycle in $name (in a block: $inBlock)', async ({ body, inBlock }) => {
    expect(await ran(body, inBlock)).toEqual(finished);
  });
});

describe("the oracle's walk", () => {
  it('starts from the futures a resolver written into is registered on, which its registering gave edges', () => {
    // A cell holding a wait, which holds what its case resolver is registered on, a future holding
    // the cell: a cycle reaching the resolver that registering it closed.
    const heap = testHeap([
      { kind: 'cell', id: 0, type: 0, value: handleTo(1) },
      { kind: 'wait', id: 1, waiter: 9, state: { kind: 'pending' } },
      { kind: 'future', id: 2, state: { kind: 'resolved', value: handleTo(0) } },
      {
        kind: 'resolver',
        id: 3,
        state: {
          kind: 'pending',
          target: { kind: 'case', wait: 1, position: 0 },
          on: [2],
          onCancel: [],
        },
      },
    ]);
    expect(() => oracle.changed({ heap, types: [] }, [3], new Set())).toThrow(
      'A cycle reaching a disposable holds objects 0:cell, 1:wait, 2:future.',
    );
  });
});
