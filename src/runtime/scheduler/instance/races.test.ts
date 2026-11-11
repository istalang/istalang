/**
 * Racing through `Resolver.at` (proposal 8, Rule 5): a `Resolver.at` resolver decides another with
 * its position in the same step, so `futures.first` decides as a `select`'s cases do, its losers
 * consuming nothing (spec §8). A slot operation a losing case awaited is passed over while no
 * resolver registered on it is pending, and served once awaited again; a `select` that doesn't wait
 * awaits nothing, so it leaves one as it was. Resolvers decided together go by
 * rank: per wait its lowest case, within it the lowest position, then the earliest registration.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';
import { recordingFutures } from './futures.test-kit.ts';

const imports = [
  "import * as futures from 'futures'",
  "import * as runtime from 'runtime'",
  "import * as time from 'time'",
];

/** `main`, given every line of `lines`, run to its end, crashing at every await or not. */
function ended(lines: readonly string[], crashEveryAwait = false) {
  return startToEnd(testRuntime(), compiledText([...imports, ...lines].join('\n')), {
    crashEveryAwait,
  });
}

/** A non-blocking read of `s`: its value, or -1 when it is empty. */
const peek = [
  'ista fn peek(s: Slot<Int>) -> Int:',
  '  select:',
  '    case s.read() as v: v',
  '    else: -1',
];

describe('futures.first in a select', () => {
  it('wins at its case when its future resolves together with a later case', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const f0 = time.delay(1s)',
      '  const f1 = time.delay(1s)',
      '  await select:',
      '    case futures.first([f0]): 0',
      '    case f1: 1',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '0' });
  });

  it.each([false, true])(
    'decides as its value arrives, a later case taking nothing (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        ...peek,
        'ista async fn fill(s0: Slot<Int>, s1: Slot<Int>):',
        '  await runtime.commit()',
        '  _ = s0.put(10)',
        '  _ = s1.put(20)',
        'live async fn main() -> (Int, Int, Int): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Int, Int):',
        '  const s0 = Slot.create<Int>()',
        '  const s1 = Slot.create<Int>()',
        '  _ = fill(s0, s1)',
        '  const won = await select:',
        '    case futures.first([s0.take()]) as pair: pair.1',
        '    case s1.take() as v: v',
        '  await runtime.commit()',
        '  (won, peek(s0), peek(s1))',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({
        kind: 'finished',
        outcome: '[10,-1,20]',
      });
    },
  );

  it('takes nothing from a later future once an earlier one had resolved', async () => {
    const main = [
      ...peek,
      'live async fn main() -> (Int, Int): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Int):',
      '  const full = Slot.create<Int>()',
      '  _ = full.put(1)',
      '  const s = Slot.create<Int>()',
      '  const (position, _) = await futures.first([full.read(), s.take()])',
      '  _ = s.put(3)',
      '  (position, peek(s))',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '[0,3]' });
  });
});

describe('a select that does not wait', () => {
  it.each([false, true])(
    'leaves a held take in its slot queue, having awaited nothing (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        'live async fn main() -> (Int, Int, Int): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Int, Int):',
        '  const s = Slot.create<Int>()',
        '  const held = s.take()',
        '  const polled = select:',
        '    case held as v: v',
        '    else: -1',
        '  _ = s.put(7)',
        '  const late = s.take()',
        '  _ = s.put(8)',
        '  (polled, await held, await late)',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({
        kind: 'finished',
        outcome: '[-1,7,8]',
      });
    },
  );
});

describe('a slot operation a losing case awaited', () => {
  it.each([false, true])(
    'is passed over while nothing awaits it, and served once awaited again (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        ...peek,
        'live async fn main() -> (Int, Int, Int): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Int, Int):',
        '  const s = Slot.create<Int>()',
        '  const pending = s.take()',
        '  const got = await select:',
        '    case pending as v: v',
        '    case runtime.commit(): 0',
        '  _ = s.put(5)',
        '  const left = peek(s)',
        '  (got, left, await pending)',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({
        kind: 'finished',
        outcome: '[0,5,5]',
      });
    },
  );
});

describe('a Resolver.at resolver', () => {
  it('is cancelled at once made for a resolver no longer pending', async () => {
    const main = [
      'shared struct Took:',
      '  took: Bool',
      'struct Late:',
      '  took: Took',
      '  type Mode = "ista"',
      'ista fn onAwait(self: Late, done: Resolver<(Int, Int), "ista">):',
      '  done.resolve((7, 8))',
      '  self.took->took = Resolver.at(done, 0).tryResolve(1)',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const took = new Took{took: true}',
      '  const (position, value) = await Late{took}',
      '  position * 10 + value + (if took->took: 100 else: 0)',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '78' });
  });

  it.each([false, true])(
    'keeps what a cold awaitable started through it as long as its wait (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        'ista async fn later(value: Int) -> Int:',
        '  await runtime.commit()',
        '  value',
        'struct Earliest:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Earliest, done: Resolver<(Int, Int), "ista">):',
        '  later(2).onAwait(Resolver.at(done, 1))',
        '  later(1).onAwait(Resolver.at(done, 0))',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const (position, value) = await Earliest',
        '  position * 10 + value',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({ kind: 'finished', outcome: '12' });
    },
  );
});

describe('resolvers decided together', () => {
  /** Waits whose callbacks are recorded, over futures pending until resolved together. */
  function racing(count: number) {
    const { calls, waits, futures } = recordingFutures();
    const ids = Array.from({ length: count }, () => futures.create({ kind: 'timer', at: 1n }));
    const resolveAll = () =>
      futures.resolveTogether(ids.map((id, future) => ({ id, value: BigInt(future) })));
    return { waits, calls, ids, resolveAll };
  }

  it('decide at the lowest position, whatever the order registered in', () => {
    const { waits, calls, ids, resolveAll } = racing(2);
    const done = waits.callback('done');
    waits.register(waits.at(done, 1n), ids[0] ?? -1, undefined);
    waits.register(waits.at(done, 0n), ids[1] ?? -1, undefined);
    resolveAll();
    expect(calls).toEqual([['done', [{ kind: 'tuple', elements: [0n, 1n] }]]]);
  });

  it("decide one resolver with its earliest registration's future", () => {
    const { waits, calls, ids, resolveAll } = racing(2);
    const done = waits.callback('done');
    waits.register(done, ids[1] ?? -1, undefined);
    waits.register(done, ids[0] ?? -1, undefined);
    resolveAll();
    expect(calls).toEqual([['done', [1n]]]);
  });
});
