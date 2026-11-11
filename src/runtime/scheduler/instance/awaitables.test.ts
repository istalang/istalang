/**
 * Awaitables (proposal 8, Rule 5): `await` and a `select`'s case call `onAwait` with a resolver
 * of their wait, so any type with one is awaited as a future is, its work starting only then, and
 * its `Mode` the kind it waits in. A resolver is one-shot: a second `resolve` panics, `tryResolve`
 * says whether it took the value, one its wait was decided without ignores both, and one let go
 * of unresolved panics.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';

/** `main`, given every line of `lines`, run to its end, crashing at every await or not. */
function ended(lines: readonly string[], crashEveryAwait = false) {
  const text = compiledText(["import * as runtime from 'runtime'", ...lines].join('\n'));
  return startToEnd(testRuntime(), text, { crashEveryAwait });
}

/** An awaitable resolving its wait with `value` from its `onAwait`, counting its starts. */
const cold = [
  'shared struct Starts:',
  '  count: Int',
  'struct Cold:',
  '  starts: Starts',
  '  value: Int',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Cold, done: Resolver<Int, "ista">):',
  '  self.starts->count = self.starts->count + 1',
  '  done.resolve(self.value)',
];

/** An awaitable waiting on a future of its own through that future's `onAwait`. */
const delegated = [
  'struct Delegated:',
  '  inner: Future<Int, "ista">',
  '  type Mode = "ista"',
  'ista fn onAwait(self: Delegated, done: Resolver<Int, "ista">): self.inner.onAwait(done)',
  'ista async fn later(value: Int) -> Int:',
  '  await runtime.commit()',
  '  value',
];

describe('an awaitable', () => {
  it('starts its work only once it is awaited', async () => {
    const main = [
      'ista async fn main() -> Int:',
      '  const starts = new Starts{count: 0}',
      '  const awaited = Cold{starts: starts, value: 7}',
      '  const before = starts->count',
      '  const got = await awaited',
      '  before * 100 + starts->count * 10 + got',
    ];
    expect(await ended([...cold, ...main])).toEqual({ kind: 'finished', outcome: '17' });
  });

  it.each([false, true])(
    "waits on a future through that future's onAwait (crashing at every await: %s)",
    async (crashEveryAwait) => {
      const main = ['ista async fn main() -> Int: await Delegated{inner: later(42)}'];
      expect(await ended([...delegated, ...main], crashEveryAwait)).toEqual({
        kind: 'finished',
        outcome: '42',
      });
    },
  );

  it("races in a select, a case's value given by its own onAwait", async () => {
    const main = [
      'ista async fn main() -> Int:',
      '  const starts = new Starts{count: 0}',
      '  await select:',
      '    case Delegated{inner: later(1)} as slow:',
      '      slow',
      '    case Cold{starts: starts, value: 2} as fast:',
      '      fast * 10 + starts->count',
    ];
    expect(await ended([...cold, ...delegated, ...main])).toEqual({
      kind: 'finished',
      outcome: '21',
    });
  });

  it('waits in memory in a live run, its Mode live, committing nothing', async () => {
    const text = compiledText(
      [
        'struct Ticket:',
        '  type Mode = "live"',
        'live fn onAwait(self: Ticket, done: Resolver<Int, "live">): done.resolve(41)',
        'live async fn run() -> Int: 1 + await Ticket',
        'ista async fn main(): 0',
      ].join('\n'),
    );
    const test = testRuntime();
    const run = await test.runtime.deploy(text).start('live', { function: 'main.run()' });
    expect(run.state).toMatchObject({ kind: 'finished', outcome: 42n });
    expect(test.store.commits).toEqual([]);
  });

  it('may run a select of its own in onAwait, a wait apart from the one it was called for', async () => {
    const peek = [
      'struct Peek:',
      '  inner: Future<Int, "ista">',
      '  type Mode = "ista"',
      'ista fn onAwait(self: Peek, done: Resolver<Int, "ista">):',
      '  select:',
      '    case self.inner as ready:',
      '      done.resolve(ready + 100)',
      '    else:',
      '      self.inner.onAwait(done)',
      'ista async fn now(value: Int) -> Int: value',
      'ista async fn main() -> Int:',
      '  const first = await Peek{inner: now(1)}',
      '  first * 10 + await Peek{inner: later(2)}',
    ];
    expect(await ended([...delegated, ...peek])).toEqual({ kind: 'finished', outcome: '1012' });
  });

  it('starts a cold async call inside onAwait and waits for it to finish', async () => {
    const coldAsync = [
      'shared struct Starts:',
      '  count: Int',
      'ista async fn work(starts: Starts, value: Int) -> Int:',
      '  starts->count = starts->count + 1',
      '  await runtime.commit()',
      '  value',
      'struct ColdWork:',
      '  starts: Starts',
      '  value: Int',
      '  type Mode = "ista"',
      'ista fn onAwait(self: ColdWork, done: Resolver<Int, "ista">):',
      '  work(self.starts, self.value).onAwait(done)',
      'ista async fn main() -> Int:',
      '  const starts = new Starts{count: 0}',
      '  const job = ColdWork{starts: starts, value: 7}',
      '  const before = starts->count',
      '  const got = await job',
      '  before * 100 + starts->count * 10 + got',
    ];
    expect(await ended(coldAsync)).toEqual({ kind: 'finished', outcome: '17' });
  });

  it('converts an awaited operand that fits onAwait through an implicit conversion', async () => {
    const converted = [
      'struct Left { x: Int }',
      'struct Right { y: Int }',
      'ista fn onAwait(self: Left | Right, done: Resolver<Int, "ista">):',
      '  match self:',
      '    case Left{x}: done.resolve(x)',
      '    case Right{y}: done.resolve(y)',
      'ista async fn main() -> Int:',
      '  const a = await Left{x: 20}',
      '  const b = await (later(22),)',
      '  a + b',
    ];
    expect(await ended([...delegated, ...converted])).toEqual({
      kind: 'finished',
      outcome: '42',
    });
  });

  it('runs a disposed call cleanup case in select even when an earlier case resolved in onAwait', async () => {
    const cleanup = [
      'shared struct Log:',
      '  text: String',
      'ista async fn worker(starts: Starts, log: Log):',
      '  await select:',
      '    case Cold{starts: starts, value: 1}:',
      '      log->text = "cold"',
      '    case worker.disposing():',
      '      log->text = "cleaned up"',
      'ista async fn main() -> String:',
      '  const starts = new Starts{count: 0}',
      '  const log = new Log{text: "none"}',
      '  {',
      '    const running = worker(starts, log)',
      '  }',
      '  log->text',
    ];
    expect(await ended([...cold, ...cleanup])).toEqual({
      kind: 'finished',
      outcome: '"cleaned up"',
    });
  });

  it('disposes a handle held only by a decided wait when a select case discards its value', async () => {
    const discarded = [
      'shared struct Log:',
      '  disposed: Int',
      'shared struct Lease:',
      '  log: Log',
      'ista fn dispose(self: Lease):',
      '  self->log->disposed = self->log->disposed + 1',
      'trait Marker {}',
      'shared struct Box:',
      '  done: Resolver<any Marker, "ista">?',
      'struct WaitBox:',
      '  box: Box',
      '  type Mode = "ista"',
      'ista fn onAwait(self: WaitBox, done: Resolver<any Marker, "ista">):',
      '  self.box->done = done',
      'ista async fn giver(box: Box, log: Log):',
      '  await runtime.commit()',
      '  const lease: any Marker = new Lease{log: log}',
      '  box->done!.resolve(lease)',
      'ista async fn main() -> Int:',
      '  const log = new Log{disposed: 0}',
      '  const box = new Box{done: none}',
      '  const wb = WaitBox{box: box}',
      '  _ = giver(box, log)',
      '  let inside = -1',
      '  await select:',
      '    case wb as m:',
      '      inside = log->disposed',
      '      _ = m',
      '  inside * 10 + log->disposed',
    ];
    expect(await ended(discarded)).toEqual({ kind: 'finished', outcome: '1' });
  });
});

describe("an awaitable's resolver", () => {
  /** An awaitable whose `onAwait` runs `body`, with `done` its resolver. */
  const awaiting = (...body: readonly string[]) => [
    'shared struct Took:',
    '  first: Bool',
    '  second: Bool',
    'struct Twice:',
    '  took: Took',
    '  type Mode = "ista"',
    'ista fn onAwait(self: Twice, done: Resolver<Int, "ista">):',
    ...body.map((line) => `  ${line}`),
    'ista async fn main() -> Int:',
    '  const took = new Took{first: false, second: false}',
    '  const got = await Twice{took: took}',
    '  got * 100 + (if took->first: 10 else: 0) + (if took->second: 1 else: 0)',
  ];

  it('panics resolved twice', async () => {
    expect(await ended(awaiting('done.resolve(1)', 'done.resolve(2)'))).toMatchObject({
      kind: 'panicked',
      message: 'A resolver was resolved twice.',
    });
  });

  it('says whether tryResolve took the value', async () => {
    const body = [
      'self.took->first = done.tryResolve(4)',
      'self.took->second = done.tryResolve(5)',
    ];
    expect(await ended(awaiting(...body))).toEqual({ kind: 'finished', outcome: '410' });
  });

  it('panics let go of unresolved, its wait never to be decided', async () => {
    expect(await ended(awaiting('_ = self.took'))).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('so the wait it was to decide never can.'),
    });
  });

  it('does nothing once another case decided its wait, kept or not', async () => {
    const kept = [
      'shared struct Kept:',
      '  done: Resolver<Int, "ista">?',
      'struct Keep:',
      '  kept: Kept',
      '  type Mode = "ista"',
      'ista fn onAwait(self: Keep, done: Resolver<Int, "ista">): self.kept->done = done',
      'ista async fn main() -> Int:',
      '  const kept = new Kept{done: none}',
      '  const starts = new Starts{count: 0}',
      '  const got = await select:',
      '    case Keep{kept: kept} as never:',
      '      never',
      '    case Cold{starts: starts, value: 3} as value:',
      '      value',
      '  kept->done!.resolve(9)',
      '  got * 10 + (if kept->done!.tryResolve(9): 1 else: 0)',
    ];
    expect(await ended([...cold, ...kept])).toEqual({ kind: 'finished', outcome: '30' });
  });

  it('cancels a later losing case resolver before releasing its case holdings when an earlier case resolved in onAwait', async () => {
    const losingAfterCold = [
      'shared struct Kept:',
      '  done: Resolver<Int, "ista">?',
      'struct Keep:',
      '  kept: Kept',
      '  type Mode = "ista"',
      'ista fn onAwait(self: Keep, done: Resolver<Int, "ista">): self.kept->done = done',
      'ista async fn main() -> Int:',
      '  const starts = new Starts{count: 0}',
      '  await select:',
      '    case Cold{starts: starts, value: 3} as value:',
      '      value',
      '    case Keep{kept: new Kept{done: none}} as never:',
      '      never',
    ];
    expect(await ended([...cold, ...losingAfterCold])).toEqual({
      kind: 'finished',
      outcome: '3',
    });
  });

  it('returns false from tryResolve on a later case resolver once an earlier case decided the wait in onAwait', async () => {
    const tryAfterCold = [
      'shared struct Took:',
      '  took: Bool',
      'struct TryAfter:',
      '  took: Took',
      '  type Mode = "ista"',
      'ista fn onAwait(self: TryAfter, done: Resolver<Int, "ista">):',
      '  self.took->took = done.tryResolve(99)',
      'ista async fn main() -> Int:',
      '  const starts = new Starts{count: 0}',
      '  const took = new Took{took: true}',
      '  const got = await select:',
      '    case Cold{starts: starts, value: 3} as value:',
      '      value',
      '    case TryAfter{took: took} as never:',
      '      never',
      '  got * 10 + (if took->took: 1 else: 0)',
    ];
    expect(await ended([...cold, ...tryAfterCold])).toEqual({
      kind: 'finished',
      outcome: '30',
    });
  });

  it('may be given to several futures, the first to resolve deciding it', async () => {
    const twoFutures = [
      'struct TwoFutures:',
      '  first: Future<Int, "ista">',
      '  second: Future<Int, "ista">',
      '  type Mode = "ista"',
      'ista fn onAwait(self: TwoFutures, done: Resolver<Int, "ista">):',
      '  self.first.onAwait(done)',
      '  self.second.onAwait(done)',
      'ista async fn now(value: Int) -> Int: value',
      'ista async fn main() -> Int:',
      '  await TwoFutures{first: later(1), second: now(2)}',
    ];
    expect(await ended([...delegated, ...twoFutures])).toEqual({
      kind: 'finished',
      outcome: '2',
    });
  });

  it('panics when a later select case drops its resolver in onAwait even if an earlier case resolved in onAwait', async () => {
    const dropCase = [
      'struct Dropped:',
      '  type Mode = "ista"',
      'ista fn onAwait(self: Dropped, done: Resolver<Int, "ista">): ()',
      'ista async fn main() -> Int:',
      '  const starts = new Starts{count: 0}',
      '  await select:',
      '    case Cold{starts: starts, value: 1} as v: v',
      '    case Dropped as v: v',
    ];
    expect(await ended([...cold, ...dropCase])).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('so the wait it was to decide never can.'),
    });
  });

  it('clears a WeakRef to a resolved or cancelled resolver when let go of, without breaking commit', async () => {
    const weakResolver = [
      'shared struct HeldWeak:',
      '  weak: WeakRef<Resolver<Int, "ista">>?',
      'struct WatchResolver:',
      '  held: HeldWeak',
      '  type Mode = "ista"',
      'ista fn onAwait(self: WatchResolver, done: Resolver<Int, "ista">):',
      '  self.held->weak = WeakRef(done)',
      '  done.resolve(42)',
      'ista async fn main() -> Int:',
      '  const held = new HeldWeak{weak: none}',
      '  const v = await WatchResolver{held: held}',
      '  await runtime.commit()',
      '  if held->weak!.deref() == none: v else: 0',
    ];
    expect(await ended(weakResolver)).toEqual({ kind: 'finished', outcome: '42' });
  });
});
