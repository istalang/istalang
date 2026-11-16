/**
 * Programs that close a cycle through a disposable at run time across language constructs, each
 * as the statements of a soup's `_main` and the declarations it adds (lifetimes-soups.sweep.test.ts
 * runs them): static lifetimes must reject each with a cycle diagnostic.
 */

interface CyclicCase {
  readonly name: string;
  readonly body: readonly string[];
  readonly extra?: readonly string[];
}

export const cyclicPrograms: readonly CyclicCase[] = [
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
    extra: ['ista fn unwrapWeak(w: WeakRef<Parent>) -> Parent?: w.deref()'],
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
  },
  {
    name: 'a function named as a value writing into a context constant',
    body: [
      'const n = new GlobNode{lease: new Lease{n: 1}, box: globalBox}',
      'const f = stashGlob',
      'f(n)',
    ],
    extra: ['ista fn stashGlob(n: GlobNode): globalBox->value = n'],
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
    extra: ['const makeLinker = fn() -> any Linker: Impl'],
  },
  {
    name: 'a call through `any` converted part-by-part inside an array',
    body: [
      'const raw = [Impl]',
      'const linkers: Array<any Linker> = raw',
      'linkers[0].connect(a, a)',
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
  },
  {
    name: 'a sync wrapper forwarding `&` to an async call',
    body: ['let f: Future<Unit, "ista">? = none', 'f = startHold(&f)'],
    extra: [
      'ista async fn holdRef(x: &Future<Unit, "ista">?): await runtime.commit()',
      'ista fn startHold(x: &Future<Unit, "ista">?) -> Future<Unit, "ista">: holdRef(&x)',
    ],
  },
  {
    name: 'an async lambda called as a value with `&`',
    body: [
      'const g = ista async fn(x: &Future<Unit, "ista">?): await runtime.commit()',
      'let f: Future<Unit, "ista">? = none',
      'f = g(&f)',
    ],
  },
  {
    name: 'a symbolic requirement call linking two fields of `self`',
    body: [
      'const p = new Parent{}',
      'const ch = new Child{}',
      'p->child = ch',
      'runSelfLink(Pair{p, ch})',
    ],
    extra: [
      'trait SelfLinker:',
      '  fn linkSelf(self: Self)',
      'fn linkSelf(self: Pair): self.ch->parent = self.p',
      'fn runSelfLink<T is SelfLinker>(x: T): x.linkSelf()',
    ],
  },
  {
    name: 'a symbolic requirement call writing into a context constant',
    body: ['const n = new GlobNode{lease: new Lease{n: 1}, box: globalBox}', 'runStash(n)'],
    extra: [
      'trait Stasher:',
      '  ista fn stash(self: Self)',
      'ista fn stash(self: GlobNode): globalBox->value = self',
      'ista fn runStash<T is Stasher>(x: T): x.stash()',
    ],
  },
  {
    name: 'a generic conversion into `any` whose witness returns its argument',
    body: ['const id = boxAny(Impl)', 'a->next = id.same(a)'],
    extra: [
      'trait Identity:',
      '  ista fn same(self: Self, n: Node) -> Node',
      'ista fn same(self: Impl, n: Node) -> Node: n',
      'fn boxAny<T is Identity>(x: T) -> any Identity: x',
    ],
  },
  {
    name: 'a nominal struct converted to a shape holding `any`',
    body: [
      'const h = Holder{l: Impl}',
      'const shaped: { l: any Linker } = h',
      'shaped.l.connect(a, a)',
    ],
    extra: ['struct Holder { l: Impl }'],
  },
  {
    name: 'an optional array `Array<Impl>?` converted to `Array<any Linker>?`',
    body: [
      'const opt: Array<Impl>? = [Impl]',
      'const xs: Array<any Linker>? = opt',
      'xs![0].connect(a, a)',
    ],
  },
  {
    name: 'a plain function `ista fn() -> Impl` converted to `ista async fn() -> any Linker`',
    body: [
      'const f: ista fn() -> Impl = ista fn() -> Impl: Impl',
      'const g: ista async fn() -> any Linker = f',
      'const l = await g()',
      'l.connect(a, a)',
    ],
  },
  {
    name: 'a contravariant function parameter converting `Impl` into `any Linker`',
    body: [
      'const takeAny: ista fn(any Linker) -> Unit = ista fn(l: any Linker): l.connect(a, a)',
      'const takeImpl: ista fn(Impl) -> Unit = takeAny',
      'takeImpl(Impl)',
    ],
  },
  {
    name: 'a part read out of an input bounced through a local handle cell',
    body: ['b->next = a', 'bounce(b, a)'],
    extra: [
      'ista fn bounce(whole: Node, target: Node):',
      '  const temp = new Shared<Node?>{value: whole->next}',
      '  whole->next = new Node{lease: new Lease{n: 9}}',
      '  if temp->value is Node as p2:',
      '    target->next = p2',
    ],
  },
  {
    name: 'a helper linking two parts of one struct parameter',
    body: ['linkPair(NodePair{a, b})', 'b->next = a'],
    extra: [
      'struct NodePair { a: Node, b: Node }',
      'ista fn linkPair(p: NodePair): p.a->next = p.b',
    ],
  },
  {
    name: 'a factory returning a future and the node its call holds',
    body: ['const (f, n) = startWorker()', 'n->call = f'],
    extra: [
      'ista fn startWorker() -> (Future<Unit, "ista">, Node):',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  (holding(n), n)',
    ],
  },
  {
    name: 'a factory returning a parent and the child it holds',
    body: ['const (p, ch) = makeParentAndChild()', 'ch->parent = p'],
    extra: [
      'ista fn makeParentAndChild() -> (Parent, Child):',
      '  const p = new Parent{}',
      '  const ch = new Child{}',
      '  p->child = ch',
      '  (p, ch)',
    ],
  },
  {
    name: 'a part read out of an input copied between local handle cells by a helper',
    body: ['b->next = a', 'bounceCopy(b, a)'],
    extra: [
      'ista fn copyBox(src: Shared<Node?>, dst: Shared<Node?>): dst->value = src->value',
      'ista fn bounceCopy(whole: Node, target: Node):',
      '  const held = new Shared<Node?>{value: whole->next}',
      '  whole->next = new Node{lease: new Lease{n: 9}}',
      '  const dst = new Shared<Node?>{value: none}',
      '  copyBox(held, dst)',
      '  if dst->value is Node as p2:',
      '    target->next = p2',
    ],
  },
  {
    name: 'an async call linking its arguments before an `await` it never returns from',
    body: ['drop linkAndHang(a, b)', 'b->next = a'],
    extra: [
      'ista async fn linkAndHang(x: Node, y: Node):',
      '  x->next = y',
      '  await runtime.commit()',
      '  _ = panic("hang") + 1',
    ],
  },
  {
    name: 'a helper result read out of an input and stored in a local handle cell',
    body: ['b->next = a', 'bounceCall(b, a)'],
    extra: [
      'ista fn getNext(x: Node) -> Node?: x->next',
      'ista fn bounceCall(whole: Node, target: Node):',
      '  const temp = new Shared<Node?>{value: none}',
      '  temp->value = getNext(whole)',
      '  if temp->value is Node as p2:',
      '    target->next = p2',
    ],
  },
  {
    name: "an async call's frame holding what a `WeakRef` gave",
    body: ['const o = new Owner{}', 'const f = holdDeref(WeakRef(o))', 'o->call = f'],
    extra: [
      'shared struct Owner { call: Future<Unit, "ista">? = none }',
      'ista fn dispose(self: Owner): ()',
      'ista async fn holdDeref(w: WeakRef<Owner>):',
      '  const strong = w.deref()',
      '  await runtime.commit()',
      '  _ = strong',
    ],
  },
  {
    name: 'a helper storing what a `WeakRef` gave into a parameter',
    body: [
      'const p = new Parent{}',
      'const holder = new Shared<Parent?>{value: none}',
      'storeDeref(WeakRef(p), holder)',
      'if holder->value is Parent as n:',
      '  p->next = n',
    ],
    extra: [
      'ista fn storeDeref(w: WeakRef<Parent>, holder: Shared<Parent?>): holder->value = w.deref()',
    ],
  },
  {
    name: 'a default parameter holding the argument before it, returned',
    body: ['const ch = new Child{}', 'const p = linkDefault(ch)', 'ch->parent = p'],
    extra: ['ista fn linkDefault(ch: Child, p: Parent = new Parent{child: ch}) -> Parent: p'],
  },
  {
    name: 'an awaitable whose `onAwait` links two of its fields',
    body: ['b->next = a', 'await LinkingAwaitable{a, b}'],
    extra: [
      'struct LinkingAwaitable { a: Node, b: Node, type Mode = "ista" }',
      'ista fn onAwait(self: LinkingAwaitable, done: Resolver<Unit, "ista">):',
      '  self.a->next = self.b',
      '  done.resolve(())',
    ],
  },
  {
    name: "an async call's future settling with a default holding the argument before it",
    body: ['const ch = new Child{}', 'const p = await echoDefault(ch)', 'ch->parent = p'],
    extra: ['ista async fn echoDefault(ch: Child, p: Parent = new Parent{child: ch}) -> Parent: p'],
  },
];
