/**
 * A host's live resolvers (proposal 8, Rule 9): a host extern returning a future takes the resolver
 * of the live future its call gives a live run, and resolves it later, once; it learns when the
 * future is disposed first; and letting go of it unresolved panics the run, naming the extern.
 */

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import type { Advanced } from '../instance-state.ts';
import { asLive, testRuntime } from '../runtime.test-kit.ts';
import type { HostCall, HostExterns, HostResolver } from './host-natives.ts';

setFlagsFromString('--expose_gc');
/** A full collection of JavaScript's heap, which runs what a `FinalizationRegistry` was told. */
const collectGarbage = runInNewContext('gc') as () => void;

const text = compiledText(
  [
    "import * as time from 'time'",
    'extern ista fn fetch(name: String) -> Future<Int, "ista">',
    'ista async fn fetched() -> Int:',
    '  1 + await fetch("a")',
    'ista async fn raced() -> Int:',
    '  await select:',
    '    case fetch("a") as n:',
    '      n',
    '    case time.delay(5ms):',
    '      0',
    'async fn main(): 0',
  ].join('\n'),
);
const fetchKey = 'main.fetch(String)';

/** Starts `entry` as a live run of the program, with `fetch` as the host's. */
function startLive(fetch: HostExterns[string], entry = 'main.fetched()'): Promise<Advanced> {
  const program = testRuntime({ host: { [fetchKey]: fetch } }).runtime.deploy(asLive(text));
  return program.start('live', { function: entry });
}

/** `run`, with how it ended once it has. */
function trackedRun(run: Promise<Advanced>) {
  const tracked: { ended: Advanced | undefined; done: Promise<Advanced> } = {
    ended: undefined,
    done: run.then((advanced) => {
      tracked.ended = advanced;
      return advanced;
    }),
  };
  return tracked;
}

/** Collects JavaScript's garbage, up to `times` times, while `going` says so. */
async function collectWhile(going: () => boolean, times: number): Promise<void> {
  for (let attempt = 0; going() && attempt < times; attempt += 1) {
    collectGarbage();
    // biome-ignore lint/performance/noAwaitInLoops: each collection waits for the registry's callbacks.
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** A host whose `fetch` takes its resolver and hands it out. */
function handingOut() {
  const handed = Promise.withResolvers<HostResolver>();
  const fetch = (_arguments: readonly unknown[], call: HostCall) => {
    handed.resolve(call.resolver());
  };
  return { fetch, resolver: handed.promise };
}

describe("a host's live resolver", () => {
  it('resolves the future its call gave, later and from outside the run', async () => {
    const host = handingOut();
    const run = startLive(host.fetch);
    (await host.resolver).resolve(41n);
    expect((await run).state).toMatchObject({ kind: 'finished', outcome: 42n });
  });

  it('resolves it within the call too, the run seeing the value after its segment', async () => {
    const run = startLive((_arguments, call) => {
      call.resolver().resolve(41n);
    });
    expect((await run).state).toMatchObject({ kind: 'finished', outcome: 42n });
  });

  it('takes nothing through tryResolve once it resolved', async () => {
    const host = handingOut();
    const run = startLive(host.fetch);
    const resolver = await host.resolver;
    expect(resolver.tryResolve(41n)).toBe(true);
    expect(resolver.tryResolve(1n)).toBe(false);
    expect((await run).state).toMatchObject({ kind: 'finished', outcome: 42n });
  });

  it('tells the host once when its future is disposed unresolved, and takes nothing after', async () => {
    const host = handingOut();
    const run = startLive(host.fetch, 'main.raced()');
    const resolver = await host.resolver;
    const cancelled: string[] = [];
    resolver.onCancel(() => cancelled.push('first'));
    resolver.onCancel(() => cancelled.push('second'));
    expect((await run).state).toMatchObject({ kind: 'finished', outcome: 0n });
    expect(cancelled).toEqual(['first', 'second']);
    expect(resolver.tryResolve(5n)).toBe(false);
    expect(() => {
      resolver.resolve(5n);
    }).not.toThrow();
    expect(cancelled).toHaveLength(2);
  });

  it('panics its run, naming the extern, once the host lets go of it unresolved', async () => {
    const run = trackedRun(
      startLive((_arguments, call) => {
        call.resolver();
      }),
    );
    await collectWhile(() => run.ended === undefined, 100);
    expect(run.ended?.state).toMatchObject({
      kind: 'panicked',
      message: "The host's main.fetch dropped its resolver unresolved.",
    });
    expect(run.ended?.state.kind === 'panicked' ? run.ended.state.trace : '').toContain(
      'main.fetched',
    );
  });

  it('keeps its run waiting while the host holds only its resolve function', async () => {
    const kept = Promise.withResolvers<HostResolver['resolve']>();
    const run = trackedRun(
      startLive((_arguments, call) => {
        const { resolve } = call.resolver();
        kept.resolve(resolve);
      }),
    );
    const resolve = await kept.promise;
    await collectWhile(() => run.ended === undefined, 20);
    expect(run.ended).toBeUndefined();
    resolve(41n);
    expect((await run.done).state).toMatchObject({ kind: 'finished', outcome: 42n });
  });

  it("is its future's one producer once taken, a promise the extern gives back as well resolving nothing", async () => {
    const host = handingOut();
    const run = startLive(async (_arguments, call) => {
      await host.fetch(_arguments, call);
    });
    const resolver = await host.resolver;
    await new Promise((resolve) => setImmediate(resolve));
    resolver.resolve(41n);
    expect((await run).state).toMatchObject({ kind: 'finished', outcome: 42n });
  });

  it('panics at once when a live extern gives back no promise and takes no resolver', async () => {
    expect((await startLive(() => undefined)).state).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('took no resolver'),
    });
  });

  it('panics the run when resolved a second time', async () => {
    const host = handingOut();
    const run = startLive(host.fetch);
    const resolver = await host.resolver;
    resolver.resolve(41n);
    try {
      resolver.resolve(1n);
    } catch {
      // Even if resolve throws synchronously, the waiting run itself must panic on a second resolve.
    }
    expect((await run).state).toMatchObject({
      kind: 'panicked',
      message: "The host's main.fetch resolved its future twice.",
    });
  });

  it("can't be taken by an instance's extern, whose future the host fills by a token", async () => {
    const test = testRuntime({ host: { [fetchKey]: (_arguments, call) => call.resolver() } });
    const advanced = await test.runtime.deploy(text).start('ista', { function: 'main.fetched()' });
    expect(advanced.state).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('An instance waits on no future a live resolver resolves'),
    });
  });
});
