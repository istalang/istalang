/**
 * Resolvers (proposal 8, Rule 5): a wait is decided by the first of its futures to resolve, and a
 * `select` lets go of the cases it lost then, before anything else runs: a losing `take` consumes
 * nothing, even when a value reaches its slot right after the winner's. A call disposed after its
 * `select` was decided still resumes on its `disposing()` case (§7). A crash discards a decision
 * with its segment.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';

const raced = compiledText(
  [
    "import * as runtime from 'runtime'",
    'ista async fn fill(a: Slot<Int>, b: Slot<Int>):',
    '  await runtime.commit()',
    '  _ = a.put(1)',
    '  _ = b.put(2)',
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
    '  const a = Slot.create<Int>()',
    '  const b = Slot.create<Int>()',
    '  const filling = fill(a, b)',
    '  const got = await select:',
    '    case a.take() as x:',
    '      x',
    '    case b.take() as y:',
    '      y',
    '  const left = await b.take()',
    '  await filling',
    '  got * 10 + left',
  ].join('\n'),
);

const disposedAfterDecided = compiledText(
  [
    "import Inbox from 'inbox'",
    "import * as runtime from 'runtime'",
    'ista async fn worker(box: Inbox<Int>, log: Inbox<String>):',
    '  await select:',
    '    case box.receive():',
    '      log.send("received")',
    '    case worker.disposing():',
    '      log.send("cleaned up")',
    'live async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String:',
    '  const box = Inbox.create<Int>()',
    '  const log = Inbox.create<String>()',
    '  if true:',
    '    const w = worker(box, log)',
    '    await runtime.commit()',
    '    box.send(1)',
    '  await log.receive()',
  ].join('\n'),
);

describe('resolvers', () => {
  it.each([false, true])(
    "leave a select's losing slot its value, put right after the winner's (crashing at every await: %s)",
    async (crashEveryAwait) => {
      expect(await startToEnd(testRuntime(), raced, { crashEveryAwait })).toEqual({
        kind: 'finished',
        outcome: '12',
      });
    },
  );

  it('resume a call disposed after its select was decided on its disposing() case', async () => {
    expect(await startToEnd(testRuntime(), disposedAfterDecided)).toEqual({
      kind: 'finished',
      outcome: '"cleaned up"',
    });
  });

  it("leaves a slot's value when a select on it is won by read() over take()", async () => {
    const readWinsOverTake = compiledText(
      [
        "import * as runtime from 'runtime'",
        'ista async fn fill(s: Slot<Int>):',
        '  await runtime.commit()',
        '  _ = s.put(42)',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const s = Slot.create<Int>()',
        '  const filling = fill(s)',
        '  const got = await select:',
        '    case s.read() as x:',
        '      x',
        '    case s.take() as y:',
        '      y',
        '  const left = await s.take()',
        '  await filling',
        '  got * 100 + left',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), readWinsOverTake)).toEqual({
      kind: 'finished',
      outcome: '4242',
    });
  });

  it("leaves a slot's value to a losing cold take, held only by its resolver", async () => {
    const coldTakeLoses = compiledText(
      [
        "import * as runtime from 'runtime'",
        'struct ColdTake:',
        '  slot: Slot<Int>',
        '  type Mode = "ista"',
        'ista fn onAwait(self: ColdTake, done: Resolver<Int, "ista">): self.slot.take().onAwait(done)',
        'ista async fn fill(s: Slot<Int>):',
        '  await runtime.commit()',
        '  _ = s.put(42)',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const s = Slot.create<Int>()',
        '  const cold = ColdTake{slot: s}',
        '  const filling = fill(s)',
        '  const got = await select:',
        '    case s.read() as x:',
        '      x',
        '    case cold as y:',
        '      y',
        '  const left = await s.take()',
        '  await filling',
        '  got * 100 + left',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), coldTakeLoses)).toEqual({
      kind: 'finished',
      outcome: '4242',
    });
  });

  it("leaves a slot's value to a later take when a losing case keeps only its disposing() watch", async () => {
    const keptForDisposal = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'struct Now:',
        '  type Mode = "ista"',
        'ista fn onAwait(self: Now, done: Resolver<Unit, "ista">): done.resolve(())',
        'struct TakeOrDisposed:',
        '  take: Future<Unit, "ista">',
        '  disposing: Future<Unit, "ista">',
        '  type Mode = "ista"',
        'ista fn onAwait(self: TakeOrDisposed, done: Resolver<Unit, "ista">):',
        '  self.take.onAwait(done)',
        '  self.disposing.onAwait(done)',
        'ista async fn worker(s: Slot<Unit>) -> String:',
        '  await select:',
        '    case TakeOrDisposed{take: s.take(), disposing: worker.disposing()}: "took"',
        '    case Now: "now"',
        'live async fn main() -> String: await runtime.run(runtime.id()) _main()\nista async fn _main() -> String:',
        '  const s = Slot.create<Unit>()',
        '  const working = worker(s)',
        '  const put = s.put(())',
        '  const got = await working',
        '  await select:',
        '    case s.take(): got + ", value kept"',
        '    case time.delay(1s): got + ", value lost"',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), keptForDisposal)).toEqual({
      kind: 'finished',
      outcome: '"now, value kept"',
    });
  });

  it.each([
    [
      'slot reads',
      [
        "import * as runtime from 'runtime'",
        'ista async fn fill(s: Slot<Int>):',
        '  await runtime.commit()',
        '  _ = s.put(5)',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const s = Slot.create<Int>()',
        '  const r2 = s.read()',
        '  const r1 = s.read()',
        '  const filling = fill(s)',
        '  const picked = await select:',
        '    case r1 as x:',
        '      x + 10',
        '    case r2 as y:',
        '      y + 20',
        '  await filling',
        '  picked',
      ].join('\n'),
      '15',
    ],
    [
      'timers',
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const t2 = time.delay(5ms)',
        '  const t1 = time.delay(5ms)',
        '  await select:',
        '    case t1:',
        '      1',
        '    case t2:',
        '      2',
      ].join('\n'),
      '1',
    ],
    [
      'disposal watches',
      [
        "import Inbox from 'inbox'",
        "import * as runtime from 'runtime'",
        'ista async fn watchBoth(d1: Future<Unit, "ista">, d2: Future<Unit, "ista">) -> Int:',
        '  await select:',
        '    case d1:',
        '      1',
        '    case d2:',
        '      2',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const box = Inbox.create<Int>()',
        '  const w = WeakRef(box)',
        '  const d2 = w.disposed()',
        '  const d1 = w.disposed()',
        '  const watching = watchBoth(d1, d2)',
        '  await runtime.commit()',
        '  drop box',
        '  await watching',
      ].join('\n'),
      '1',
    ],
  ])(
    'picks the first case in order when several %s resolve together',
    async (_kind, source, expected) => {
      expect(await startToEnd(testRuntime(), compiledText(source))).toEqual({
        kind: 'finished',
        outcome: expected,
      });
    },
  );

  it('readies waiters in execution creation order when their timers resolve together', async () => {
    const readyOrder = compiledText(
      [
        "import Inbox from 'inbox'",
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'ista async fn waitOn(timer: Future<Unit, "ista">, log: Inbox<Int>, tag: Int):',
        '  await timer',
        '  log.send(tag)',
        'live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Array<Int>:',
        '  const log = Inbox.create<Int>()',
        '  const t2 = time.delay(5ms)',
        '  const t1 = time.delay(5ms)',
        '  const first = waitOn(t1, log, 1)',
        '  const second = waitOn(t2, log, 2)',
        '  await first',
        '  await second',
        '  [await log.receive(), await log.receive()]',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), readyOrder)).toEqual({
      kind: 'finished',
      outcome: '[1,2]',
    });
  });

  it('releases holdings created in a losing disposing() case expression as the select is decided', async () => {
    const losingDisposingHoldings = compiledText(
      [
        "import Inbox from 'inbox'",
        "import * as runtime from 'runtime'",
        'ista async fn worker(a: Slot<Int>, log: Inbox<String>) -> Int:',
        '  await select:',
        '    case a.take() as x:',
        '      x',
        '    case (log.sendRevertible("stale"), worker.disposing()).1:',
        '      0',
        'live async fn main() -> Array<String>: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Array<String>:',
        '  const a = Slot.create<Int>()',
        '  const log = Inbox.create<String>()',
        '  const w = worker(a, log)',
        '  await runtime.commit()',
        '  _ = a.put(1)',
        '  const seen = log.pending()',
        '  _ = await w',
        '  seen',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), losingDisposingHoldings)).toEqual({
      kind: 'finished',
      outcome: '[]',
    });
  });

  it('releases losing case holdings in a non-blocking select and when resuming on disposing()', async () => {
    const nonBlockingAndDisposing = compiledText(
      [
        "import Inbox from 'inbox'",
        "import * as runtime from 'runtime'",
        'ista async fn worker(a: Slot<Int>, log: Inbox<String>):',
        '  await select:',
        '    case (log.sendRevertible("other"), a.take()).1:',
        '      ()',
        '    case worker.disposing():',
        '      log.send(String(log.pending().length()))',
        'live async fn main() -> (Int, Array<String>): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Array<String>):',
        '  const a = Slot.create<Int>()',
        '  const log = Inbox.create<String>()',
        '  const nonBlocking = select:',
        '    case (log.sendRevertible("lost"), a.take()).1:',
        '      1',
        '    else:',
        '      log.pending().length()',
        '  if true:',
        '    const w = worker(a, log)',
        '    await runtime.commit()',
        '  (nonBlocking, [await log.receive()])',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), nonBlockingAndDisposing)).toEqual({
      kind: 'finished',
      outcome: '[0,["0"]]',
    });
  });

  it('cancels a losing case resolver when its Resolver.at is resolved or tried after an earlier case decided the wait in onAwait', async () => {
    const losingAt = compiledText(
      [
        "import * as runtime from 'runtime'",
        'shared struct Seen { cancelled: Int, took: Bool }',
        'struct ResolveAt:',
        '  seen: Seen',
        '  type Mode = "ista"',
        'ista fn onAwait(self: ResolveAt, done: Resolver<(Int, Int), "ista">):',
        '  done.onCancel(fn(): { self.seen->cancelled += 1; () })',
        '  Resolver.at(done, 0).resolve(9)',
        'struct TryAt:',
        '  seen: Seen',
        '  type Mode = "ista"',
        'ista fn onAwait(self: TryAt, done: Resolver<(Int, Int), "ista">):',
        '  done.onCancel(fn(): { self.seen->cancelled += 10; () })',
        '  self.seen->took = Resolver.at(done, 0).tryResolve(9)',
        'live async fn main() -> (Int, Int, Bool): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Int, Bool):',
        '  const seen = new Seen{cancelled: 0, took: true}',
        '  const got = await select:',
        '    case runtime.commit(): 1',
        '    case ResolveAt{seen} as pair: pair.1',
        '    case TryAt{seen} as pair: pair.1',
        '  await runtime.commit()',
        '  (got, seen->cancelled, seen->took)',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), losingAt)).toEqual({
      kind: 'finished',
      outcome: '[1,11,false]',
    });
  });

  it('breaks ties by earliest registration when one resolver is registered on several futures that resolve together', async () => {
    const multiRegistered = compiledText(
      [
        "import * as runtime from 'runtime'",
        'struct RaceReads:',
        '  first: Future<Int, "ista">',
        '  second: Future<Int, "ista">',
        '  type Mode = "ista"',
        'ista fn onAwait(self: RaceReads, done: Resolver<Int, "ista">):',
        '  self.first.onAwait(done)',
        '  self.second.onAwait(done)',
        'ista async fn fill(s: Slot<Int>):',
        '  await runtime.commit()',
        '  _ = s.put(7)',
        'live async fn main() -> (Int, Int): await runtime.run(runtime.id()) _main()\nista async fn _main() -> (Int, Int):',
        '  const s = Slot.create<Int>()',
        '  const t = Slot.create<Int>()',
        '  const r1 = s.read()',
        '  const r2 = t.read()',
        '  _ = fill(s)',
        '  _ = fill(t)',
        '  const firstWon = await RaceReads{first: r1, second: r2}',
        '  const secondWon = await RaceReads{first: r2, second: r1}',
        '  (firstWon, secondWon)',
      ].join('\n'),
    );
    expect(await startToEnd(testRuntime(), multiRegistered)).toEqual({
      kind: 'finished',
      outcome: '[7,7]',
    });
  });
});
