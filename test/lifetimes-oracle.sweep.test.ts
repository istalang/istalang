/**
 * Static lifetimes is sound (docs/work/static-lifetimes/plan.md, C3): over soups of writes,
 * closures, async calls, inboxes and awaitables, a program the checker accepts never trips the
 * oracle when it runs (runtime/lifetimes/oracle.test-kit.ts), and one it rejects is rejected for a
 * cycle alone, since every fragment checks otherwise.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../src/compiler/binder/bind.test-kit.ts';
import { isCycle } from '../src/compiler/checker/rules/lifetimes/lifetimes.test-kit.ts';
import { checkedAfterStd, compiledText, diagnosedAt } from '../src/compiler/compile.test-kit.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { startToEnd, testRuntime } from '../src/runtime/runtime.test-kit.ts';

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
  'ista async fn holding(n: Node): await runtime.commit()',
  'ista fn link(x: Node, y: Node): x->next = y',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
  'ista async fn _main() -> Int:',
  '  const a = new Node{lease: new Lease{n: 1}}',
  '  const b = new Node{}',
  '  const c = new Node{lease: new Lease{n: 2}}',
  '  const box = Inbox.create<Node>()',
];

/** Statements over `a`, `b`, `c` and `box`, each checking on its own but for a cycle it closes. */
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
];

/** `body`'s statements run in `_main`, after the declarations, then a commit. */
function programOf(body: readonly string[], extra: readonly string[] = []): string {
  return [
    ...declarations.slice(0, -5),
    ...extra,
    ...declarations.slice(-5),
    ...body.map((line) => `  ${line}`),
    '  await runtime.commit()',
    '  0',
  ].join('\n');
}

interface CyclicCase {
  readonly name: string;
  readonly body: readonly string[];
  readonly extra?: readonly string[];
}

/**
 * Programs that close a cycle through a disposable at run time across language constructs: the
 * checker must reject each with a cycle diagnostic, never let it run into the oracle.
 */
const cyclicPrograms: readonly CyclicCase[] = [
  {
    name: 'an async call holding a reference to a local `let` assigned its future',
    body: ['let f: Future<Unit, "ista">? = none', 'f = holdRef(&f)'],
    extra: ['ista async fn holdRef(x: &Future<Unit, "ista">?): await runtime.commit()'],
  },
  {
    name: 'an async call holding a reference to a local array that keeps its future',
    body: ['let xs: Array<Future<Unit, "ista">> = []', 'xs.push(holdArr(&xs))'],
    extra: ['ista async fn holdArr(xs: &Array<Future<Unit, "ista">>): await runtime.commit()'],
  },
  { name: 'a tuple destructuring binding', body: ['const (x, _) = (a, 1)', 'a->next = x'] },
  { name: 'a `for` loop over an array', body: ['for x in [a]:', '  a->next = x'] },
  { name: 'the left side of `??`', body: ['const opt: Node? = a', 'a->next = opt ?? b'] },
  {
    name: 'a `select` case binding',
    body: ['await select:', '  case give(a) as x:', '    a->next = x'],
    extra: ['ista async fn give(n: Node) -> Node: n'],
  },
  {
    name: 'a struct spread',
    body: ['const b1 = Box{item: a}', 'const b2 = Box{...b1}', 'a->next = b2.item'],
    extra: ['struct Box { item: Node }'],
  },
  { name: 'an array spread', body: ['const xs = [...[a]]', 'a->next = xs[0]'] },
  {
    name: 'a `&self` method writing into the handle behind a local `let`',
    body: ['let local = a', 'local.setNext(local)'],
    extra: ['ista fn setNext(self: &Node, y: Node): self->next = y'],
  },
  {
    name: 'a helper mutating a `&` field on a shared struct',
    body: [
      'const x = new Items{lease: new Lease{n: 1}}',
      'const y = new Items{lease: new Lease{n: 2}}',
      'putNext(&x->items, y)',
      'y->items.push(x)',
    ],
    extra: [
      'shared struct Items { lease: Lease, items: Array<Items> = [] }',
      'ista fn putNext(xs: &Array<Items>, item: Items): xs.push(item)',
    ],
  },
  {
    name: 'a top-level function named as a value returning its argument',
    body: ['const f = sameNode', 'a->next = f(a)'],
    extra: ['ista fn sameNode(n: Node) -> Node: n'],
  },
  {
    name: 'a helper returning `WeakRef.deref()`',
    body: [
      'const p = new Parent{}',
      'match unwrapWeak(WeakRef(p)):',
      '  case None: ()',
      '  case n: p->next = n',
    ],
    extra: [
      'shared struct Parent { next: Parent? = none }',
      'fn dispose(self: Parent): ()',
      'ista fn unwrapWeak(w: WeakRef<Parent>) -> Parent?: w.deref()',
    ],
  },
  {
    name: '`WeakRef.deref()` across distinct parent and child handle types',
    body: [
      'const p = new Parent{}',
      'const ch = new Child{}',
      'p->child = ch',
      'linkWeak(ch, WeakRef(p))',
    ],
    extra: [
      'shared struct Parent { child: Child? = none }',
      'fn dispose(self: Parent): ()',
      'shared struct Child { parent: Parent? = none }',
      'ista fn linkWeak(ch: Child, w: WeakRef<Parent>):',
      '  match w.deref():',
      '    case None: ()',
      '    case p: ch->parent = p',
    ],
  },
  {
    name: 'a `dispose` linking two handle fields of `self`',
    body: [
      'const p = new Parent{}',
      'const ch = new Child{}',
      'p->child = ch',
      'drop new BadDispose{p, ch}',
    ],
    extra: [
      'shared struct Parent { child: Child? = none }',
      'fn dispose(self: Parent): ()',
      'shared struct Child { parent: Parent? = none }',
      'shared struct BadDispose { p: Parent, ch: Child }',
      'fn dispose(self: BadDispose): self->ch->parent = self->p',
    ],
  },
  {
    name: 'an escaping closure linking two fields of a struct parameter',
    body: [
      'const p = new Parent{}',
      'const ch = new Child{}',
      'p->child = ch',
      'let f: fn(Pair) -> Unit = fn(_: Pair): ()',
      'f = fn(pair: Pair): { pair.ch->parent = pair.p; () }',
      'f(Pair{p, ch})',
    ],
    extra: [
      'shared struct Parent { child: Child? = none }',
      'fn dispose(self: Parent): ()',
      'shared struct Child { parent: Parent? = none }',
      'struct Pair { p: Parent, ch: Child }',
    ],
  },
  {
    name: 'a function named as a value writing into a context constant',
    body: [
      'const n = new GlobNode{lease: new Lease{n: 1}, box: globalBox}',
      'const f = stashGlob',
      'f(n)',
    ],
    extra: [
      'shared struct GlobNode { lease: Lease, box: Shared<GlobNode?> }',
      'ista const globalBox = new Shared<GlobNode?>{value: none}',
      'ista fn stashGlob(n: GlobNode): globalBox->value = n',
    ],
  },
  {
    name: 'a generic function writing through an unreduced `type match`',
    body: [
      'const s = new Shared<MatchNode?>{value: none}',
      'const n = new MatchNode{lease: new Lease{n: 1}, s: s}',
      'linkMatch<Int>(s, n)',
    ],
    extra: [
      'shared struct MatchNode { lease: Lease, s: Shared<MatchNode?> }',
      'type PickNode<T> = match T:',
      '  case Int: MatchNode',
      '  case _: MatchNode',
      'ista fn linkMatch<T>(s: Shared<PickNode<T>?>, v: PickNode<T>): s->value = v',
    ],
  },
  {
    name: 'an `await` of an async call given a temporary expression',
    body: [
      'const got = await echoNode(new Node{lease: new Lease{n: 3}, next: a})',
      'a->next = got',
    ],
    extra: ['ista async fn echoNode(n: Node) -> Node: n'],
  },
  {
    name: 'a call through `any` converted in a top-level `const` lambda',
    body: ['const l = makeLinker()', 'l.connect(a, a)'],
    extra: [
      'trait Linker:',
      '  ista fn connect(self: Self, x: Node, y: Node)',
      'struct Impl',
      'ista fn connect(self: Impl, x: Node, y: Node): x->next = y',
      'const makeLinker = fn() -> any Linker: Impl',
    ],
  },
  {
    name: 'a call through `any` converted part-by-part inside an array',
    body: [
      'const raw = [Impl]',
      'const linkers: Array<any Linker> = raw',
      'linkers[0].connect(a, a)',
    ],
    extra: [
      'trait Linker:',
      '  ista fn connect(self: Self, x: Node, y: Node)',
      'struct Impl',
      'ista fn connect(self: Impl, x: Node, y: Node): x->next = y',
    ],
  },
  {
    name: 'a call through `any` converted from an optional into `(any Linker)?`',
    body: [
      'const opt: Impl? = Impl',
      'const linker: (any Linker)? = opt',
      'match linker:',
      '  case None: ()',
      '  case l: l.connect(a, a)',
    ],
    extra: [
      'trait Linker:',
      '  ista fn connect(self: Self, x: Node, y: Node)',
      'struct Impl',
      'ista fn connect(self: Impl, x: Node, y: Node): x->next = y',
    ],
  },
];

describe('static lifetimes over fragment soups', () => {
  it('never lets a program it accepts trip the oracle, and rejects only for cycles', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...fragments), { maxLength: 8 }), async (body) => {
        const text = programOf(body);
        const program = stdProgramOf({ main: text });
        checkedAfterStd(program);
        const errors = diagnosedAt(program, 'main').diagnostics.filter(isError);
        expect(errors.filter((error) => !isCycle(error))).toEqual([]);
        const ended =
          errors.length > 0 ? 'rejected' : await startToEnd(testRuntime(), compiledText(text));
        expect(['rejected', { kind: 'finished', outcome: '0' }]).toContainEqual(ended);
      }),
      { numRuns: 60 },
    );
  });

  it.each(cyclicPrograms)(
    'rejects rather than letting the oracle trip on $name',
    async ({ body, extra = [] }) => {
      const text = programOf(body, extra);
      const program = stdProgramOf({ main: text });
      checkedAfterStd(program);
      const errors = diagnosedAt(program, 'main').diagnostics.filter(isError);
      expect(errors.filter((error) => !isCycle(error))).toEqual([]);
      const ended =
        errors.length > 0 ? 'rejected' : await startToEnd(testRuntime(), compiledText(text));
      expect(ended).toBe('rejected');
    },
  );
});
