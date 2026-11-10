/**
 * Live runs (proposal 8) through the host's API: live code started by a host runs in memory to its
 * end and never writes the store, while an instance commits at every `await`; a live run's waits
 * ride the host's promises and its clock; and a host's calls on one instance run one after another.
 * Programs are compiled as ista code, as every program is until the checker knows kinds, and made
 * live by `asLive`.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import type { HostCall } from '../boundary/host-natives.ts';
import { ManualClock } from '../clock.ts';
import type { Advanced, InstanceState } from '../instance-state.ts';
import { asLive, runToEnd, settleAll, type TestRuntime, testRuntime } from '../runtime.test-kit.ts';
import { snapshotFormat } from '../snapshot/snapshot.ts';

/** A step of a generated `main`: an `await` of a timer, of a commit or of a call, or no wait. */
type Step =
  | { readonly kind: 'delay'; readonly ms: number }
  | { readonly kind: 'commit' }
  | { readonly kind: 'call'; readonly n: number }
  | { readonly kind: 'add'; readonly n: number };

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('delay' as const), ms: fc.integer({ min: 0, max: 50 }) }),
  fc.record({ kind: fc.constant('commit' as const) }),
  fc.record({ kind: fc.constant('call' as const), n: fc.integer({ min: 0, max: 9 }) }),
  fc.record({ kind: fc.constant('add' as const), n: fc.integer({ min: 0, max: 9 }) }),
);

/** A program whose `main` runs `steps`, its callee waiting on a timer before it returns. */
function programOf(steps: readonly Step[]): string {
  const lines: Record<Step['kind'], (step: Step) => string> = {
    delay: (step) => `  await time.delay(${step.kind === 'delay' ? step.ms : 0}ms)`,
    commit: () => '  await runtime.commit()',
    call: (step) => `  total += await later(${step.kind === 'call' ? step.n : 0})`,
    add: (step) => `  total += ${step.kind === 'add' ? step.n : 0}`,
  };
  return compiledText(
    [
      "import * as time from 'time'",
      "import * as runtime from 'runtime'",
      'ista async fn later(n: Int) -> Int:',
      '  await time.delay(3ms)',
      '  n + 1',
      'ista async fn main():',
      '  let total = 0',
      ...steps.map((step) => lines[step.kind](step)),
      '  total',
    ].join('\n'),
  );
}

/** What `steps` add up to. */
function totalOf(steps: readonly Step[]): number {
  return steps.reduce((total, step) => {
    if (step.kind === 'call') {
      return total + step.n + 1;
    }
    return step.kind === 'add' ? total + step.n : total;
  }, 0);
}

/** The commits written for `instance`, in order. */
function commitsOf({ store }: TestRuntime, instance: string): readonly string[] {
  return store.commits.filter((text) => snapshotFormat.read(text).instance === instance);
}

/** `state`, a finished run's, as the JSON text of its outcome. */
function outcomeText(test: TestRuntime, text: string, state: InstanceState): string {
  if (state.kind !== 'finished') {
    throw new Error(`The run ended ${state.kind}.`);
  }
  return test.runtime.deploy(text).outcomeText(state);
}

describe('live runs', () => {
  it('never write the store, where an instance of the same program writes at every await', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArbitrary, { maxLength: 6 }), async (steps) => {
        const text = programOf(steps);
        const test = testRuntime();
        const instance = await test.runtime.deploy(text).start('ista');
        expect(await runToEnd(test, 'ista', instance)).toEqual({
          kind: 'finished',
          outcome: String(totalOf(steps)),
        });
        const awaits = steps.filter((step) => step.kind !== 'add').length;
        expect(commitsOf(test, 'ista')).toHaveLength(awaits + 1);

        const live = asLive(text);
        const written = test.store.commits.length;
        const run = await test.runtime.deploy(live).start('live');
        expect(test.store.commits).toHaveLength(written);
        expect(test.store.readSnapshot('live')).toBeUndefined();
        expect(outcomeText(test, live, run.state)).toBe(String(totalOf(steps)));
      }),
      { numRuns: 20 },
    );
  });

  const waitsOnHost = compiledText(
    [
      "import * as time from 'time'",
      'extern ista fn fetch(name: String) -> Future<Int, "ista">',
      'ista async fn fetched() -> Int:',
      '  1 + await fetch("a")',
      'ista async fn ticks():',
      '  await time.delay(5ms)',
      '  await time.delay(5ms)',
      '  7',
      'async fn main(): 0',
    ].join('\n'),
  );
  const fetchKey = 'main.fetch(String)';

  it("resolves a host's promise in memory while an instance commits", async () => {
    const answer = Promise.withResolvers<unknown>();
    const test = testRuntime({ host: { [fetchKey]: () => answer.promise } });
    const program = test.runtime.deploy(asLive(waitsOnHost, ['main.fetched', 'main.fetch']));
    let ended: Advanced | undefined;
    const live = program.start('live', { function: 'main.fetched()' }).then((advanced) => {
      ended = advanced;
      return advanced;
    });
    const ticking = await program.start('ista', { function: 'main.ticks()' });
    expect(await runToEnd(test, 'ista', ticking)).toEqual({ kind: 'finished', outcome: '7' });
    expect(commitsOf(test, 'ista')).toHaveLength(3);
    expect(ended).toBeUndefined();
    answer.resolve(41n);
    expect((await live).state).toMatchObject({ kind: 'finished', outcome: 42n });
    expect(commitsOf(test, 'live')).toEqual([]);
  });

  it('panics when the promise it waits on rejects, with a stack trace', async () => {
    const test = testRuntime({ host: { [fetchKey]: () => Promise.reject(new Error('offline')) } });
    const program = test.runtime.deploy(asLive(waitsOnHost));
    const { state } = await program.start('live', { function: 'main.fetched()' });
    expect(state).toMatchObject({
      kind: 'panicked',
      message: "The host's main.fetch rejected: offline",
    });
    expect(state.kind === 'panicked' ? state.trace : '').toContain('main.fetched');
  });

  it("panics when a host's promise resolves with a value that doesn't fit its declared type", async () => {
    const test = testRuntime({ host: { [fetchKey]: () => Promise.resolve('not-an-int') } });
    const program = test.runtime.deploy(asLive(waitsOnHost));
    expect((await program.start('live', { function: 'main.fetched()' })).state).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('expected an integer'),
    });
  });

  it('ends waiting when its only pending host promise belonged to a disposed future', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'extern ista fn fetch(name: String) -> Future<Int, "ista">',
        'ista async fn main():',
        '  const s = Slot.create<Int>()',
        '  await select:',
        '    case fetch("a"):',
        '      1',
        '    case time.delay(5ms):',
        '      await s.take()',
      ].join('\n'),
    );
    const neverSettles = new Promise<unknown>(() => undefined);
    const test = testRuntime({ host: { [fetchKey]: () => neverSettles } });
    const live = asLive(text);
    const run = await test.runtime.deploy(live).start('live');
    expect(run.state).toEqual({ kind: 'waiting', until: undefined, watching: [] });
  });

  it('resolves a settled host promise before a later timer on a manual clock', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'extern ista fn fetch(name: String) -> Future<Int, "ista">',
        'ista async fn main() -> Int:',
        '  await select:',
        '    case fetch("a") as got:',
        '      got',
        '    case time.delay(5d):',
        '      -1',
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const test = testRuntime({ clock, host: { [fetchKey]: () => Promise.resolve(42n) } });
    const live = asLive(text);
    const run = await test.runtime.deploy(live).start('live');
    expect(outcomeText(test, live, run.state)).toBe('42');
    expect(clock.now()).toBe(1000n);
  });

  it('lets go of a timer nothing waits on any more, so its clock never moves to it', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'extern ista fn fetch(name: String) -> Future<Int, "ista">',
        'ista async fn main() -> Int:',
        '  const first = await select:',
        '    case time.delay(1ms):',
        '      1',
        '    case time.delay(5d):',
        '      2',
        '  first + await fetch("a")',
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const later = () => new Promise((resolve) => setTimeout(() => resolve(41n), 5));
    const test = testRuntime({ clock, host: { [fetchKey]: later } });
    const live = asLive(text);
    const run = await test.runtime.deploy(live).start('live');
    expect(outcomeText(test, live, run.state)).toBe('42');
    expect(clock.now()).toBe(1001n);
  });

  it('resolves due timers across an await while other work is ready, as an instance does', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        "import * as runtime from 'runtime'",
        'ista async fn main() -> Int:',
        '  const due = time.delay(0ms)',
        '  await runtime.commit()',
        '  select:',
        '    case due:',
        '      1',
        '    else:',
        '      0',
      ].join('\n'),
    );
    const test = testRuntime();
    const ista = await test.runtime.deploy(text).start('ista');
    expect(await runToEnd(test, 'ista', ista)).toEqual({ kind: 'finished', outcome: '1' });

    const live = asLive(text);
    const run = await test.runtime.deploy(live).start('live');
    expect(outcomeText(test, live, run.state)).toBe('1');
  });

  it('reads the live clock on every time.now() call, not a frozen segment start time', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'extern fn tick() -> Unit',
        'async fn main() -> Int:',
        '  const before = time.now()',
        '  tick()',
        '  time.now().value - before.value',
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const test = testRuntime({
      clock,
      host: {
        'main.tick()': () => {
          clock.set(1250n);
          return null;
        },
      },
    });
    const live = asLive(text);
    const run = await test.runtime.deploy(live).start('live');
    expect(outcomeText(test, live, run.state)).toBe('250');
  });

  it('panics on a future its host fills by a token, which no fill reaches, and an instance on a promise', async () => {
    const pending = testRuntime({ host: { [fetchKey]: (_, call: HostCall) => call.pending('a') } });
    const live = pending.runtime.deploy(asLive(waitsOnHost));
    expect((await live.start('live', { function: 'main.fetched()' })).state).toMatchObject({
      kind: 'panicked',
    });
    const promised = testRuntime({ host: { [fetchKey]: () => Promise.resolve(1n) } });
    const ista = promised.runtime.deploy(waitsOnHost);
    expect((await ista.start('ista', { function: 'main.fetched()' })).state).toMatchObject({
      kind: 'panicked',
    });
  });

  it('fires a live timer on a manual clock, its code reading the clock', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'async fn main():',
        '  const before = time.now()',
        '  await time.delay(500ms)',
        '  time.now().value - before.value',
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const test = testRuntime({ clock });
    const live = asLive(text);
    const run = await test.runtime.deploy(live).start('live');
    expect(outcomeText(test, live, run.state)).toBe('500');
    expect(clock.now()).toBe(1500n);
    expect(test.store.commits).toEqual([]);
  });
});

describe("a host's calls on one instance", () => {
  it('run one after another, a call made inside another waiting for it to end', async () => {
    const text = compiledText(
      [
        "import * as runtime from 'runtime'",
        'extern fn ping() -> Int',
        'ista async fn main():',
        '  await runtime.commit()',
        '  ping()',
      ].join('\n'),
    );
    const events: string[] = [];
    let inner: Promise<number> | undefined;
    const test: TestRuntime = testRuntime({
      host: {
        'main.ping()': () => {
          events.push('ping');
          inner ??= test.runtime.wake('x').then(({ state }) => events.push(`inner ${state.kind}`));
          return 1n;
        },
      },
    });
    const outer = await test.runtime.deploy(text).start('x');
    events.push(`outer ${outer.state.kind}`);
    await settleAll(test, 'x', outer);
    await inner;
    expect(events).toEqual(['ping', 'outer finished', 'inner finished']);
    expect(commitsOf(test, 'x')).toHaveLength(2);
  });

  it('run two concurrent fills on one instance one after the other', async () => {
    const text = compiledText(
      [
        'extern ista fn ask(tag: String) -> Future<Int, "ista">',
        'ista async fn main() -> Int:',
        '  const a = ask("a")',
        '  const b = ask("b")',
        '  (await a) + (await b)',
      ].join('\n'),
    );
    const test = testRuntime({
      host: { 'main.ask(String)': ([tag], call: HostCall) => call.pending(String(tag)) },
    });
    await test.runtime.deploy(text).start('x');
    const [first, second] = await Promise.all([
      test.runtime.fill('x', 'a', 10n),
      test.runtime.fill('x', 'b', 32n),
    ]);
    expect(first.state.kind).toBe('waiting');
    expect(outcomeText(test, text, second.state)).toBe('42');
    expect(commitsOf(test, 'x')).toHaveLength(3);
  });
});
