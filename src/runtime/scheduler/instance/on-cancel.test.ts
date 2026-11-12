/**
 * A resolver's `onCancel` callbacks (proposal 8, Rule 5) run as a `Resolver.of` callback does
 * (callbacks.test.ts), once, when their resolver is cancelled: its wait decided by another case, or
 * the future it is registered on disposed first; at once when it was cancelled already, never once
 * it resolved.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { testRuntime } from '../../runtime.test-kit.ts';
import { ended, shared } from './callbacks.test-kit.ts';

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
        '  taking: Future<Int, "ista">?',
        '  value: Int',
        'ista fn dispose(self: Holder): ()',
        'ista fn report(seen: Seen, holder: Holder, cancelled: Resolver<Int, "ista">):',
        '  const took = cancelled.tryResolve(1) or holder->resolver!.tryResolve(2)',
        '  see(seen, holder->value * 10 + (if took: 1 else: 0))',
        'live async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:',
        '  const seen = new Seen{value: 0}',
        '  if true:',
        '    const holder = new Holder{resolver: none, taking: none, value: 4}',
        '    const kept = Resolver.of(fn(_: Int): ())',
        '    holder->resolver = kept',
        '    const watching = Resolver.of(fn(value: Int): kept.resolve(value))',
        '    watching.onCancel(fn(): report(seen, holder, watching))',
        '    const taking = Slot.create<Int>().take()',
        '    holder->taking = taking',
        '    taking.onAwait(kept)',
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
