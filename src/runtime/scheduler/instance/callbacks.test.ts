/**
 * Resolvers that call back (proposal 8, Rule 5): `Resolver.of(callback)` decides no wait, and
 * resolving it calls `callback` with the value, as a driver of its own, so in ista code in a segment
 * of its own, after the code that resolved it waits (`onCancel` callbacks: on-cancel.test.ts). A
 * `Resolver.of` resolver registered on a future lives as long as that future, and is cancelled
 * once let go of unresolved; it holds nothing it started, so a cold awaitable mapping a future it
 * started through one panics as its resolver is dropped.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { cyclicOracle } from '../../lifetimes/oracle.test-kit.ts';
import { runToEnd, testRuntime } from '../../runtime.test-kit.ts';
import { ended, shared, watched } from './callbacks.test-kit.ts';
import { recordingFutures } from './futures.test-kit.ts';

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
      expect(await ended(main, { crashEveryAwait })).toEqual({ kind: 'finished', outcome: '3' });
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
      expect(await ended(main, { crashEveryAwait })).toEqual({ kind: 'finished', outcome: '7' });
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
    // `slow` holds `watching`, whose `onCancel` holds `slow`: a cycle C3 rejects.
    const oracle = cyclicOracle();
    expect(await ended(main, { oracle })).toEqual({ kind: 'finished', outcome: '30' });
    expect(oracle.asExpected()).toBe(true);
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

  it.each([
    { future: 'later(1)', type: 'Int', value: '1' },
    { future: 'time.delay(1s)', type: 'Unit', value: '()' },
  ])(
    'is cancelled once the future it is registered on, $future, is let go of, though something holds it',
    async ({ future, type, value }) => {
      const main = [
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const seen = new Seen{value: 0}',
        `  const watching = Resolver.of(fn(_: ${type}): see(seen, 1))`,
        '  watching.onCancel(fn(): see(seen, -1))',
        '  if true:',
        `    const pending = ${future}`,
        '    pending.onAwait(watching)',
        '  await runtime.commit()',
        '  await runtime.commit()',
        `  seen->value * 10 + (if watching.tryResolve(${value}): 1 else: 0)`,
      ];
      expect(await ended(main)).toEqual({ kind: 'finished', outcome: '-10' });
    },
  );

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
