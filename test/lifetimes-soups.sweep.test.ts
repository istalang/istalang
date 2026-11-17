/**
 * Static lifetimes over soups of writes, closures (inert ones kept in a handle they capture among
 * them, proposal 14), async calls, inboxes and awaitables (docs/work/done/static-lifetimes/plan.md, C3):
 * a program the checker accepts compiles to a Definition the ownership verifier passes and runs to
 * its end, and one it rejects is rejected for a cycle alone, since every fragment checks otherwise.
 * Programs closing a cycle at run time (cyclic-programs.ts) are rejected.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../src/compiler/binder/bind.test-kit.ts';
import { isCycle } from '../src/compiler/checker/rules/lifetimes/lifetimes.test-kit.ts';
import { checkedAfterStd, compiledEncoded, diagnosedAt } from '../src/compiler/compile.test-kit.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { startToEnd, testRuntime } from '../src/runtime/runtime.test-kit.ts';
import { cyclicPrograms } from './cyclic-programs.ts';
import { slowTestTimeout } from './timeouts.ts';

const declarations = [
  "import Inbox from 'inbox'",
  "import * as runtime from 'runtime'",
  'shared struct Lease:',
  '  n: Int',
  'fn dispose(self: Lease): ()',
  'shared struct Node:',
  '  lease: Lease? = none',
  '  next: Node? = none',
  '  call: Future<Unit, "ista">? = none',
  '  hook: ista fn() -> Unit = fn(): ()',
  '  watch: Watch? = none',
  'shared struct Watch:',
  '  n: Int = 0',
  '  watchers: Array<inert fn() -> Unit> = []',
  'shared struct Parent { child: Child? = none, next: Parent? = none }',
  'fn dispose(self: Parent): ()',
  'shared struct Child { parent: Parent? = none }',
  'struct Pair { p: Parent, ch: Child }',
  'shared struct GlobNode { lease: Lease, box: Shared<GlobNode?> }',
  'ista const globalBox = new Shared<GlobNode?>{value: none}',
  'trait Linker:',
  '  ista fn connect(self: Self, x: Node, y: Node)',
  'struct Impl',
  'ista fn connect(self: Impl, x: Node, y: Node): x->next = y',
  'ista async fn holding(n: Node): await runtime.commit()',
  'ista fn link(x: Node, y: Node): x->next = y',
  // Helpers whose summaries carry what a call does to its arguments' parts, gives back made of
  // them, reads through a weak reference, leaves to a default, or does before it waits.
  'struct Duo { first: Node, second: Node }',
  'ista fn linkDuo(d: Duo): d.first->next = d.second',
  'ista fn relinkDuo(d: Duo): d.second->next = d.first',
  'ista fn duoOf(x: Node, y: Node) -> Duo: Duo{first: x, second: y}',
  'ista fn chainedDuo() -> Duo:',
  '  const x = new Node{lease: new Lease{n: 4}}',
  '  const y = new Node{}',
  '  x->next = y',
  '  Duo{first: x, second: y}',
  'ista fn nextOr(x: Node, y: Node = new Node{next: x}) -> Node: y',
  'shared struct Keeper { call: Future<Unit, "ista">? = none }',
  'ista fn dispose(self: Keeper): ()',
  'ista async fn holdWeak(w: WeakRef<Keeper>):',
  '  const strong = w.deref()',
  '  await runtime.commit()',
  '  _ = strong',
  'struct Linking { first: Node, second: Node, type Mode = "ista" }',
  'ista fn onAwait(self: Linking, done: Resolver<Unit, "ista">):',
  '  self.first->next = self.second',
  '  done.resolve(())',
  'ista async fn linkThenWait(x: Node, y: Node):',
  '  x->next = y',
  '  await runtime.commit()',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
];

/** The start of `_main`, which every soup's statements follow. */
const mainStart = [
  'ista async fn _main() -> Int:',
  '  const a = new Node{lease: new Lease{n: 1}}',
  '  const b = new Node{}',
  '  const c = new Node{lease: new Lease{n: 2}}',
  '  const box = Inbox.create<Node>()',
  '  const keep = new Keeper{}',
  '  const w = new Watch{}',
];

/**
 * Statements over `a`, `b`, `c`, `box`, the keeper `keep` and the watch `w`, each checking on its
 * own but for a cycle it closes.
 */
const fragments = [
  'a->next = b',
  'b->next = a',
  'b->next = c',
  'c->next = a',
  'a->next = a',
  'a->next = none',
  'b->next = none',
  'link(a, b)',
  'link(b, c)',
  'link(c, b)',
  'a->call = holding(b)',
  'b->call = holding(a)',
  'b->call = holding(b)',
  'b->call = none',
  'b->hook = ista fn(): { _ = a; () }',
  'a->hook = ista fn(): { _ = b; () }',
  'b->hook = ista fn(): { _ = b; () }',
  '(b->hook)()',
  'box.send(a)',
  'box.send(b)',
  'b->lease = new Lease{n: 3}',
  'await runtime.commit()',
  'linkDuo(Duo{first: a, second: b})',
  'linkDuo(duoOf(b, a))',
  'relinkDuo(Duo{first: c, second: b})',
  'relinkDuo(chainedDuo())',
  'linkDuo(chainedDuo())',
  'b->next = duoOf(a, c).first',
  'b->next = nextOr(a)',
  'a->next = nextOr(b, c)',
  'keep->call = holdWeak(WeakRef(keep))',
  'b->call = holdWeak(WeakRef(keep))',
  'await Linking{first: a, second: b}',
  'await Linking{first: b, second: a}',
  'drop linkThenWait(a, b)',
  'drop linkThenWait(b, a)',
  'w->watchers = [...w->watchers, fn(): { w->n = w->n + 1; () }]',
  'a->watch = w',
  'b->watch = w',
  'b->hook = ista fn(): { _ = w; () }',
  'for watcher in w->watchers: watcher()',
];

/** `body`'s statements run in `_main`, after the declarations, then a commit. */
function programOf(body: readonly string[], extra: readonly string[] = []): string {
  return [
    ...declarations,
    ...extra,
    ...mainStart,
    ...body.map((line) => `  ${line}`),
    '  await runtime.commit()',
    '  0',
  ].join('\n');
}

describe('static lifetimes over fragment soups', () => {
  it('declares what the soups share checking clean, so a soup is rejected only for its own', () => {
    const program = stdProgramOf({ main: programOf([]) });
    checkedAfterStd(program);
    expect(diagnosedAt(program, 'main').diagnostics.filter(isError)).toEqual([]);
  });

  it('accepts and runs inert closures in handles closing cycles with disposables nearby', async () => {
    const extra = [
      'shared struct Emitter { listeners: Array<inert fn(Int) -> Unit> = [] }',
      'fn on(self: Emitter, f: inert fn(Int) -> Unit):',
      '  self->listeners = [...self->listeners, f]',
      'shared struct Model { emitter: Emitter = new Emitter{}, count: Int = 0 }',
      'fn wire(m: Model):',
      '  let bonus = 1',
      '  bonus = 2',
      '  fn bump(n: Int):',
      '    m->count += n + bonus',
      '  m->emitter.on(bump)',
      'fn fire(m: Model):',
      '  for f in m->emitter->listeners: f(2)',
    ];
    const body = [
      'const m = new Model{}',
      'wire(m)',
      'a->watch = w',
      'w->watchers = [...w->watchers, fn(): fire(m)]',
      'for watcher in w->watchers: watcher()',
      'await runtime.commit()',
      'drop a',
      'for watcher in w->watchers: watcher()',
    ];
    const text = programOf(body, extra);
    const program = stdProgramOf({ main: text });
    checkedAfterStd(program);
    expect(diagnosedAt(program, 'main').diagnostics.filter(isError)).toEqual([]);
    expect(await startToEnd(testRuntime(), compiledEncoded(text))).toEqual({
      kind: 'finished',
      outcome: '0',
    });
  });

  it('runs every program it accepts to its end, and rejects only for cycles', {
    timeout: slowTestTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...fragments), { maxLength: 8 }), async (body) => {
        const text = programOf(body);
        const program = stdProgramOf({ main: text });
        checkedAfterStd(program);
        const errors = diagnosedAt(program, 'main').diagnostics.filter(isError);
        expect(errors.filter((error) => !isCycle(error))).toEqual([]);
        const ended =
          errors.length > 0 ? 'rejected' : await startToEnd(testRuntime(), compiledEncoded(text));
        expect(['rejected', { kind: 'finished', outcome: '0' }]).toContainEqual(ended);
      }),
      { numRuns: 60 },
    );
  });

  it.each(cyclicPrograms)(
    'rejects $name, which closes a cycle at run time',
    async ({ body, extra = [] }) => {
      const text = programOf(body, extra);
      const program = stdProgramOf({ main: text });
      checkedAfterStd(program);
      const errors = diagnosedAt(program, 'main').diagnostics.filter(isError);
      expect(errors.filter((error) => !isCycle(error))).toEqual([]);
      const ended =
        errors.length > 0 ? 'rejected' : await startToEnd(testRuntime(), compiledEncoded(text));
      expect(ended).toBe('rejected');
    },
  );
});
