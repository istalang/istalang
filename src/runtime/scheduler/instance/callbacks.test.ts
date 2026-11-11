/**
 * Resolvers that call back (proposal 8, Rule 5): `Resolver.of(callback)` decides no wait, and
 * resolving it calls `callback` with the value, as a driver of its own, so in ista code in a segment
 * of its own, after the code that resolved it waits. `onCancel` callbacks run the same way, once,
 * when their resolver is cancelled: its wait decided by another case, or the future it is
 * registered on disposed first; at once when it was cancelled already, never once it resolved. A
 * `Resolver.of` resolver registered on a future lives as long as that future, and is cancelled
 * once let go of unresolved; it holds nothing it started, so a cold awaitable mapping a future it
 * started through one panics as its resolver is dropped.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { runToEnd, startToEnd, testRuntime } from '../../runtime.test-kit.ts';
import { recordingFutures } from './futures.test-kit.ts';

/** What every scenario uses: somewhere to see a callback's effect, and a future that arrives later. */
const shared = [
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
const watched = [
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
function ended(lines: readonly string[], crashEveryAwait = false) {
  return startToEnd(testRuntime(), compiledText([...shared, ...watched, ...lines].join('\n')), {
    crashEveryAwait,
  });
}

describe('a Resolver.of resolver', () => {
  it.each([false, true])(
    'calls back once resolved, after the code resolving it waits (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const seen = new Seen{value: 0}',
        '  const done = Resolver.of(fn(value: Int): see(seen, value))',
        '  done.resolve(3)',
        '  const before = seen->value',
        '  await runtime.commit()',
        '  before * 10 + seen->value',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({ kind: 'finished', outcome: '3' });
    },
  );

  it.each([false, true])(
    'waits on a future without await, through its onAwait (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const seen = new Seen{value: 0}',
        '  const pending = later(7)',
        '  pending.onAwait(Resolver.of(fn(value): see(seen, value)))',
        '  const before = seen->value',
        '  await runtime.commit()',
        '  await runtime.commit()',
        '  before * 10 + seen->value',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({ kind: 'finished', outcome: '7' });
    },
  );

  it('holds nothing a cold awaitable started, which drops its resolver, naming the fix', async () => {
    const main = [
      'shared struct Box:',
      '  done: Resolver<Int, "ista">',
      'struct Mapped:',
      '  type Mode = "ista"',
      'ista fn onAwait(self: Mapped, done: Resolver<Int, "ista">):',
      '  const box = new Box{done}',
      '  later(4).onAwait(Resolver.of(fn(value): box->done.resolve(value * 10)))',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  await Mapped',
    ];
    const test = testRuntime();
    const text = compiledText([...shared, ...watched, ...main].join('\n'));
    expect(await runToEnd(test, 'deep', test.startInstance(text, 'deep'))).toMatchObject({
      kind: 'panicked',
      message:
        'A resolver was let go of unresolved, so the wait it was to decide never can. An ' +
        'awaitable keeps the work it starts alive by registering its resolver, or a ' +
        'Resolver.at of it, on that work; to map a value, await it in an async fn.',
    });
  });

  it('lives as long as its future, even once what its callback would decide is decided', async () => {
    const main = [
      'struct Either:',
      '  slow: Future<Int, "ista">',
      '  seen: Seen',
      '  type Mode = "ista"',
      'ista fn offer(done: Resolver<Int, "ista">, value: Int): _ = done.tryResolve(value)',
      'ista fn onAwait(self: Either, done: Resolver<Int, "ista">):',
      '  const watching = Resolver.of(fn(value: Int): offer(done, value))',
      '  watching.onCancel(fn(): see(self.seen, -1))',
      '  self.slow.onAwait(watching)',
      '  done.resolve(3)',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const slow = later(9)',
      '  const got = await Either{slow, seen}',
      '  await runtime.commit()',
      '  got * 10 + seen->value + 0 * await slow',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '30' });
  });

  it('is cancelled, not dropped, when the future it is registered on is disposed first', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  if true:',
      '    const pending = later(1)',
      '    const watching = Resolver.of(fn(value): see(seen, value))',
      '    watching.onCancel(fn(): see(seen, -1))',
      '    pending.onAwait(watching)',
      '  await runtime.commit()',
      '  seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '-1' });
  });

  it('panics committing a value too deep to persist that only its callback is to get', async () => {
    const main = [
      'type Deep = Array<Deep>',
      'ista fn deepen(depth: Int) -> Deep:',
      '  if depth == 0: return []',
      '  [deepen(depth - 1)]',
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const done = Resolver.of(fn(_: Deep): see(seen, 1))',
      '  done.resolve(deepen(300))',
      '  await runtime.commit()',
      '  seen->value',
    ];
    const test = testRuntime();
    const text = compiledText([...shared, ...watched, ...main].join('\n'));
    expect(await runToEnd(test, 'deep', test.startInstance(text, 'deep'))).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('deeper than the'),
    });
  });

  it('is cancelled let go of unresolved, registered on nothing', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  if true:',
      '    const dropped = Resolver.of(fn(value: Int): see(seen, value))',
      '    dropped.onCancel(fn(): see(seen, -1))',
      '  await runtime.commit()',
      '  seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '-1' });
  });

  it('calls back in memory in a live run, committing nothing', async () => {
    const text = compiledText(
      [
        ...shared,
        'live async fn run() -> Int:',
        '  const seen = new Seen{value: 0}',
        '  const timer = time.delay<"live">(1ms)',
        '  const watching = Resolver.of(fn(_: Unit): see(seen, 4))',
        '  timer.onAwait(watching)',
        '  await time.delay<"live">(2ms)',
        '  seen->value',
        'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0',
      ].join('\n'),
    );
    const test = testRuntime();
    const run = await test.runtime.deploy(text).start('live', { function: 'main.run()' });
    expect(run.state).toMatchObject({ kind: 'finished', outcome: 4n });
    expect(test.store.commits).toEqual([]);
  });
});

describe("a resolver's onCancel", () => {
  it('runs once another case decides its wait', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const got = await select:',
      '    case Watched{seen, kept: new Kept{}} as slow:',
      '      slow',
      '    case runtime.commit():',
      '      5',
      '  await runtime.commit()',
      '  got * 10 + seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '49' });
  });

  it('never runs once its resolver resolved', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const got = await Watched{seen, kept: new Kept{}}',
      '  await runtime.commit()',
      '  got * 10 + seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '10' });
  });

  it('runs at once when given to a resolver cancelled already', async () => {
    const main = [
      'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
      '  const seen = new Seen{value: 0}',
      '  const kept = new Kept{}',
      '  _ = await select:',
      '    case Watched{seen, kept} as slow:',
      '      slow',
      '    case runtime.commit():',
      '      5',
      '  await runtime.commit()',
      '  _ = kept->resolver?.onCancel(fn(): see(seen, -2))',
      '  await runtime.commit()',
      '  seen->value',
    ];
    expect(await ended(main)).toEqual({ kind: 'finished', outcome: '-2' });
  });

  it.each([false, true])(
    'runs once its resolver is let go of, given that resolver and what it holds (crashing at every await: %s)',
    async (crashEveryAwait) => {
      const main = [
        'shared struct Holder:',
        '  resolver: Resolver<Int, "ista">?',
        '  value: Int',
        'ista fn dispose(self: Holder): ()',
        'ista fn report(seen: Seen, holder: Holder, cancelled: Resolver<Int, "ista">):',
        '  const took = cancelled.tryResolve(1) or holder->resolver!.tryResolve(2)',
        '  see(seen, holder->value * 10 + (if took: 1 else: 0))',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const seen = new Seen{value: 0}',
        '  if true:',
        '    const holder = new Holder{resolver: none, value: 4}',
        '    const kept = Resolver.of(fn(_: Int): ())',
        '    holder->resolver = kept',
        '    const watching = Resolver.of(fn(value: Int): kept.resolve(value))',
        '    watching.onCancel(fn(): report(seen, holder, watching))',
        '    Slot.create<Int>().take().onAwait(kept)',
        '    later(2).onAwait(watching)',
        '  await runtime.commit()',
        '  await runtime.commit()',
        '  seen->value',
      ];
      expect(await ended(main, crashEveryAwait)).toEqual({ kind: 'finished', outcome: '41' });
    },
  );

  it('runs once its resolver is let go of in a live run, given that resolver', async () => {
    const text = compiledText(
      [
        ...shared,
        'live async fn run() -> Int:',
        '  const seen = new Seen{value: 0}',
        '  if true:',
        '    const watching = Resolver.of(fn(_: Unit): ())',
        '    watching.onCancel(fn(): see(seen, if watching.tryResolve(()): 1 else: -1))',
        '    time.delay<"live">(1s).onAwait(watching)',
        '  await time.delay<"live">(1ms)',
        '  seen->value',
        'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): 0',
      ].join('\n'),
    );
    const run = await testRuntime().runtime.deploy(text).start('live', { function: 'main.run()' });
    expect(run.state).toMatchObject({ kind: 'finished', outcome: -1n });
  });

  /**
   * Two disposables and a resolver let go of at one block's end, the resolver's callback holding
   * the second and its `onCancel` the resolver itself, the block ending with `last`; the order the
   * disposables were disposed in.
   */
  const disposedBeside = (...last: string[]) =>
    ended([
      'shared struct Log { order: Array<Int> }',
      'shared struct Item { id: Int, log: Log, r: Resolver<Int, "ista">? }',
      'ista fn dispose(self: Item): self->log->order.push(self->id)',
      'live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Array<Int>:',
      '  const log = new Log{order: []}',
      '  if true:',
      '    const d1 = new Item{id: 1, log, r: none}',
      '    const d2 = new Item{id: 2, log, r: none}',
      '    const r = Resolver.of(fn(_: Int): { _ = d2->id; () })',
      '    d2->r = r',
      '    r.onCancel(fn(): { _ = r.tryResolve(1); () })',
      ...last,
      '  await runtime.commit()',
      '  log->order',
    ]);

  it('preserves reverse-creation disposal order when an orphaned resolver whose onCancel captures itself is cancelled', async () => {
    expect(await disposedBeside('    _ = d1->id')).toEqual({ kind: 'finished', outcome: '[2,1]' });
  });

  // B76: with no use of `d1` at the block's end, `d1` is let go of before the others.
  it.fails('preserves it with no use of the first disposable at the block end', async () => {
    expect(await disposedBeside()).toEqual({ kind: 'finished', outcome: '[2,1]' });
  });

  it('disposes resources held only by a readied callback run when the instance finishes or terminates', async () => {
    const code = compiledText(
      [
        "import * as runtime from 'runtime'",
        'extern shared struct Lease',
        'extern fn makeLease() -> Lease',
        'extern fn dispose(self: Lease)',
        'ista async fn finishWithRun() -> Int:',
        '  const lease = makeLease()',
        '  const r = Resolver.of(fn(l: Lease): { _ = l; () })',
        '  r.resolve(lease)',
        '  0',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const lease = makeLease()',
        '  const r = Resolver.of(fn(l: Lease): { _ = l; () })',
        '  r.resolve(lease)',
        '  await runtime.commit()',
        '  panic("boom")',
        '# Roots the ista entry the test starts by name: only code a live start reaches is kept.',
        'live async fn reach():',
        '  _ = await runtime.run(runtime.id()) finishWithRun()',
        '  0',
      ].join('\n'),
    );
    let disposed = 0;
    const test = testRuntime({
      host: {
        'main.makeLease()': () => 'lease-1',
        'main.dispose(main.Lease)': () => {
          disposed += 1;
          return null;
        },
      },
    });
    test.startInstance(code, 'finishing', { function: 'main.finishWithRun' });
    expect(disposed).toBe(1);
    test.startInstance(code, 'terminating');
    await test.runtime.terminate('terminating');
    expect(disposed).toBe(2);
  });
});

describe('callbacks of futures resolved together', () => {
  it("are each called once, with its future's value, in the order their resolvers were made", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain((count) =>
          fc.record({
            count: fc.constant(count),
            registeredOn: fc.array(fc.nat({ max: count - 1 }), { minLength: 1, maxLength: 6 }),
            resolved: fc.subarray(Array.from({ length: count }, (_, future) => future)),
          }),
        ),
        ({ count, registeredOn, resolved }) => {
          const { heap, calls, waits, futures } = recordingFutures();
          const ids = Array.from({ length: count }, () =>
            futures.create({ kind: 'timer', at: 1n }),
          );
          registeredOn.forEach((future, made) => {
            const done = waits.callback(BigInt(made));
            waits.register(done, ids[future] ?? -1, undefined);
          });
          futures.resolveTogether(
            resolved.map((future) => ({ id: ids[future] ?? -1, value: BigInt(future) })),
          );
          const expected = registeredOn.flatMap((future, made) =>
            resolved.includes(future) ? [[BigInt(made), [BigInt(future)]] as const] : [],
          );
          expect(calls).toEqual(expected);
          for (const [future, id] of ids.entries()) {
            expect(heap.find('resolvers', id).length).toBe(
              resolved.includes(future) ? 0 : registeredOn.filter((on) => on === future).length,
            );
          }
        },
      ),
    );
  });
});
