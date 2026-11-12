/**
 * Live runs (proposal 8) through the host's API: live code started by a host runs in memory to its
 * end and never writes the store, while an instance commits at every `await`; a live run's waits
 * ride the host's promises and its clock; and a host's calls on one instance run one after another.
 * A live run is a host's start of live code; an instance is started directly (`startInstance`), as
 * ista code runs in a context, whose commits a run of its own ends before it answers.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { ManualClock } from '../clock.ts';
import type { Advanced, InstanceState } from '../instance-state.ts';
import { runToEnd, type TestRuntime, testRuntime } from '../runtime.test-kit.ts';
import { snapshotFormat } from '../snapshot/snapshot.ts';

/**
 * The lines of a program's `main`: live code running `body` itself, a live run, or, as a rewritten
 * `main` is, live code calling `body`, as `_main` here, in a context, whose ista code commits at
 * every await. `returns` is its return type, with its arrow, if any.
 */
function mainLines(mode: 'live' | 'ista', returns: string, body: readonly string[]): string[] {
  return mode === 'live'
    ? [`live async fn main()${returns}:`, ...body]
    : [
        `live async fn main()${returns}: await runtime.run(runtime.id()) _main()`,
        `ista async fn _main()${returns}:`,
        ...body,
      ];
}

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
function programOf(steps: readonly Step[], mode: 'live' | 'ista'): string {
  const lines: Record<Step['kind'], (step: Step) => string> = {
    delay: (step) => `  await time.delay(${step.kind === 'delay' ? step.ms : 0}ms)`,
    commit: () => (mode === 'ista' ? '  await runtime.commit()' : ''),
    call: (step) => `  total += await later(${step.kind === 'call' ? step.n : 0})`,
    add: (step) => `  total += ${step.kind === 'add' ? step.n : 0}`,
  };
  return compiledText(
    [
      "import * as time from 'time'",
      "import * as runtime from 'runtime'",
      `${mode} async fn later(n: Int) -> Int:`,
      '  await time.delay(3ms)',
      '  n + 1',
      ...mainLines(mode, '', [
        '  let total = 0',
        ...steps.map((step) => lines[step.kind](step)).filter((line) => line !== ''),
        '  total',
      ]),
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
        const text = programOf(steps, 'ista');
        const test = testRuntime();
        const instance = test.startInstance(text, 'ista');
        expect(await runToEnd(test, 'ista', instance)).toEqual({
          kind: 'finished',
          outcome: BigInt(totalOf(steps)),
        });
        const awaits = steps.filter((step) => step.kind !== 'add').length;
        expect(commitsOf(test, 'ista')).toHaveLength(awaits + 1);

        const live = programOf(steps, 'live');
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
      "import * as time from 'time'\nimport * as runtime from 'runtime'",
      'extern live fn fetch(name: String) -> Future<Int, "live">',
      'live async fn fetched() -> Int:',
      '  1 + await fetch("a")',
      'live async fn main(): await runtime.run(runtime.id()) _main()',
      'ista async fn _main() -> Int:',
      '  await time.delay(5ms)',
      '  await time.delay(5ms)',
      '  7',
    ].join('\n'),
  );
  const fetchKey = 'main.fetch(String)';

  it("resolves a host's promise in memory while an instance commits", async () => {
    const answer = Promise.withResolvers<unknown>();
    const test = testRuntime({ host: { [fetchKey]: () => answer.promise } });
    const program = test.runtime.deploy(waitsOnHost);
    let ended: Advanced | undefined;
    const live = program.start('live', { function: 'main.fetched()' }).then((advanced) => {
      ended = advanced;
      return advanced;
    });
    const ticking = test.startInstance(waitsOnHost, 'ista');
    expect(await runToEnd(test, 'ista', ticking)).toEqual({ kind: 'finished', outcome: 7n });
    expect(commitsOf(test, 'ista')).toHaveLength(3);
    expect(ended).toBeUndefined();
    answer.resolve(41n);
    expect((await live).state).toMatchObject({ kind: 'finished', outcome: 42n });
    expect(commitsOf(test, 'live')).toEqual([]);
  });

  it('panics when the promise it waits on rejects, with a stack trace', async () => {
    const test = testRuntime({ host: { [fetchKey]: () => Promise.reject(new Error('offline')) } });
    const program = test.runtime.deploy(waitsOnHost);
    const { state } = await program.start('live', { function: 'main.fetched()' });
    expect(state).toMatchObject({
      kind: 'panicked',
      message: "The host's main.fetch rejected: offline",
    });
    expect(state.kind === 'panicked' ? state.trace : '').toContain('main.fetched');
  });

  it("panics when a host's promise resolves with a value that doesn't fit its declared type", async () => {
    const test = testRuntime({ host: { [fetchKey]: () => Promise.resolve('not-an-int') } });
    const program = test.runtime.deploy(waitsOnHost);
    expect((await program.start('live', { function: 'main.fetched()' })).state).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('expected an integer'),
    });
  });

  it('ends waiting when its only pending host promise belonged to a disposed future', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'",
        'extern live fn fetch(name: String) -> Future<Int, "live">',
        'shared struct Kept { done: Resolver<Int, "live">? }',
        'struct Forever:',
        '  kept: Kept',
        '  type Mode = "live"',
        'live fn onAwait(self: Forever, done: Resolver<Int, "live">): self.kept->done = done',
        'live async fn main() -> Int:',
        '  await select:',
        '    case fetch("a"):',
        '      1',
        '    case time.delay(5ms):',
        '      await Forever{kept: new Kept{done: none}}',
      ].join('\n'),
    );
    const neverSettles = new Promise<unknown>(() => undefined);
    const test = testRuntime({ host: { [fetchKey]: () => neverSettles } });
    const run = await test.runtime.deploy(text).start('live');
    expect(run.state).toEqual({ kind: 'waiting', until: undefined, watching: [] });
  });

  it('resolves a settled host promise before a later timer on a manual clock', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'extern live fn fetch(name: String) -> Future<Int, "live">',
        ...mainLines('live', ' -> Int', [
          '  await select:',
          '    case fetch("a") as got:',
          '      got',
          '    case time.delay(5d):',
          '      -1',
        ]),
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const test = testRuntime({ clock, host: { [fetchKey]: () => Promise.resolve(42n) } });
    const run = await test.runtime.deploy(text).start('live');
    expect(outcomeText(test, text, run.state)).toBe('42');
    expect(clock.now()).toBe(1000n);
  });

  it('lets go of a timer nothing waits on any more, so its clock never moves to it', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'extern live fn fetch(name: String) -> Future<Int, "live">',
        ...mainLines('live', ' -> Int', [
          '  const first = await select:',
          '    case time.delay(1ms):',
          '      1',
          '    case time.delay(5d):',
          '      2',
          '  first + await fetch("a")',
        ]),
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const later = () => new Promise((resolve) => setTimeout(() => resolve(41n), 5));
    const test = testRuntime({ clock, host: { [fetchKey]: later } });
    const run = await test.runtime.deploy(text).start('live');
    expect(outcomeText(test, text, run.state)).toBe('42');
    expect(clock.now()).toBe(1001n);
  });

  it('resolves due timers across an await while other work is ready, as an instance does', async () => {
    const programIn = (mode: 'live' | 'ista') =>
      compiledText(
        [
          "import * as time from 'time'",
          "import * as runtime from 'runtime'",
          ...mainLines(mode, ' -> Int', [
            '  const due = time.delay(0ms)',
            ...(mode === 'ista' ? ['  await runtime.commit()'] : ['  await time.delay(0ms)']),
            '  select:',
            '    case due:',
            '      1',
            '    else:',
            '      0',
          ]),
        ].join('\n'),
      );
    const test = testRuntime();
    const ista = test.startInstance(programIn('ista'), 'ista');
    expect(await runToEnd(test, 'ista', ista)).toEqual({ kind: 'finished', outcome: 1n });

    const live = programIn('live');
    const run = await test.runtime.deploy(live).start('live');
    expect(outcomeText(test, live, run.state)).toBe('1');
  });

  it('reads the live clock on every time.now() call, not a frozen segment start time', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'extern fn tick() -> Unit',
        ...mainLines('live', ' -> Int', [
          '  const before = time.now()',
          '  tick()',
          '  time.now().value - before.value',
        ]),
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
    const run = await test.runtime.deploy(text).start('live');
    expect(outcomeText(test, text, run.state)).toBe('250');
  });

  it('fires a live timer on a manual clock, its code reading the clock', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        ...mainLines('live', '', [
          '  const before = time.now()',
          '  await time.delay(500ms)',
          '  time.now().value - before.value',
        ]),
      ].join('\n'),
    );
    const clock = new ManualClock(1000n);
    const test = testRuntime({ clock });
    const run = await test.runtime.deploy(text).start('live');
    expect(outcomeText(test, text, run.state)).toBe('500');
    expect(clock.now()).toBe(1500n);
    expect(test.store.commits).toEqual([]);
  });

  it('disposes values in the same order after a dropped WeakRef whether or not the heap doubled at an await', async () => {
    const runWithUnheldBox = async (extraBox: boolean): Promise<readonly string[]> => {
      const notes: string[] = [];
      const text = compiledText(
        [
          "import * as time from 'time'",
          'extern fn note(text: String)',
          'shared struct Box { n: Int }',
          'shared struct Lease { name: String }',
          'fn dispose(self: Lease): note(self->name)',
          'live async fn resolved(lease: Lease) -> Lease: lease',
          'live async fn main() -> Int:',
          '  let kept: Array<Box> = []',
          `  for i in 0..${extraBox ? 10 : 0}:`,
          '    kept.push(new Box{n: i})',
          '  await time.delay(1ms)',
          '  if true:',
          '    const older = new Lease{name: "older"}',
          '    const future = resolved(new Lease{name: "newer"})',
          '    drop WeakRef(future)',
          '    await time.delay(1ms)',
          '  kept.length()',
        ].join('\n'),
      );
      const test = testRuntime({
        host: {
          'main.note(String)': ([name]) => {
            notes.push(String(name));
            return null;
          },
        },
      });
      const run = await test.runtime.deploy(text).start('live');
      expect(run.state).toMatchObject({ kind: 'finished' });
      return notes;
    };
    expect(await runWithUnheldBox(true)).toEqual(['newer', 'older']);
    expect(await runWithUnheldBox(false)).toEqual(['newer', 'older']);
  });
});

describe("a host's calls on one instance", () => {
  it('run one after another, a call made inside another waiting for it to end', async () => {
    const text = compiledText(
      [
        "import * as time from 'time'\nimport * as runtime from 'runtime'",
        'extern fn ping() -> Int',
        ...mainLines('ista', '', ['  await time.delay(1ms)', '  ping()']),
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
    test.startInstance(text, 'x');
    test.clock.set(test.clock.now() + 1n);
    const outer = await test.runtime.wake('x');
    events.push(`outer ${outer.state.kind}`);
    await inner;
    expect(events).toEqual(['ping', 'outer finished', 'inner finished']);
    expect(commitsOf(test, 'x')).toHaveLength(2);
  });
});
