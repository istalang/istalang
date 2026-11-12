/**
 * The lifetime rule on design.md §12's examples: what builds structures, appends, replies, links
 * generically and reaches through weak references is accepted, and every write or call that may
 * close a cycle through a disposable is found where it closes.
 */

import { describe, expect, it } from 'vitest';
import { findingsIn } from './lifetimes.test-kit.ts';

const lease = [
  'shared struct Lease:',
  '  n: Int',
  'fn dispose(self: Lease): ()',
  'shared struct Node:',
  '  lease: Lease',
  '  next: Node? = none',
].join('\n');

/** `body` as the body of `fn subject`, after the lease declarations and `declarations`. */
function inSubject(body: string, declarations: readonly string[] = []): string {
  return [
    lease,
    ...declarations,
    'ista fn subject():',
    ...body.split('\n').map((line) => `  ${line}`),
  ].join('\n');
}

describe('the lifetime rule', () => {
  it('accepts a list built in a loop', () => {
    const source = inSubject(
      [
        'let prev: Node? = none',
        'for i in 0..3:',
        '  prev = new Node{lease: new Lease{n: i}, next: prev}',
      ].join('\n'),
    );
    expect(findingsIn(source)).toEqual([]);
  });

  it('accepts appending at the tail through a fresh node', () => {
    const source = inSubject(
      [
        'let tail = new Node{lease: new Lease{n: 0}}',
        'for i in 0..3:',
        '  const n = new Node{lease: new Lease{n: i}}',
        '  tail->next = n',
        '  tail = n',
      ].join('\n'),
    );
    expect(findingsIn(source)).toEqual([]);
  });

  it('finds a node written into itself, and through a function linking two', () => {
    const source = inSubject(
      ['const a = new Node{lease: new Lease{n: 0}}', 'a->next = a', 'link(a, a)'].join('\n'),
      ['fn link(x: Node, y: Node): x->next = y'],
    );
    expect(findingsIn(source)).toEqual(['10:write', '11:call']);
  });

  it('finds a parent pointer', () => {
    const source = inSubject(
      [
        'const node = new Node{lease: new Lease{n: 0}}',
        'const child = new Node{lease: new Lease{n: 1}}',
        'node->next = child',
        'child->next = node',
      ].join('\n'),
    );
    expect(findingsIn(source)).toEqual(['11:write']);
  });

  it('finds an async call written into what it holds', () => {
    const source = inSubject(
      ['const s = new Shared<Future<Unit, "ista">?>{value: none}', 's->value = worker(s)'].join(
        '\n',
      ),
      ['ista async fn worker(s: Shared<Future<Unit, "ista">?>) -> Unit: ()'],
    );
    expect(findingsIn(source)).toEqual(['10:write']);
  });

  it("finds a slot's own pending take put into it", () => {
    const source = inSubject(
      [
        'const s = Slot.create<Pending>()',
        'const t = s.take()',
        '_ = s.put(Pending{take: t})',
      ].join('\n'),
      ['struct Pending:', '  take: Future<Pending, "ista">'],
    );
    expect(findingsIn(source)).toEqual(['12:call']);
  });

  it('accepts a generic link used with a value', () => {
    const source = inSubject(['const s = new Shared<Int?>{value: none}', 'link(s, 3)'].join('\n'), [
      'fn link<T>(a: Shared<T?>, b: T): a->value = b',
    ]);
    expect(findingsIn(source)).toEqual([]);
  });

  it('accepts a closure calling itself through its captured `let`', () => {
    const source = inSubject('let f: fn() -> Int = fn: f()\ndrop f()');
    expect(findingsIn(source)).toEqual([]);
  });

  it('finds a closure holding a disposable written into its own cell', () => {
    const source = inSubject(
      [
        'const l = new Lease{n: 1}',
        'let f: fn() -> Int = fn: l->n',
        'f = fn: l->n + f()',
        'drop f()',
      ].join('\n'),
    );
    expect(findingsIn(source)).toEqual(['10:write']);
  });

  it('accepts a cycle that reaches no disposable', () => {
    const source = inSubject(['const r = new Ring{}', 'r->next = r'].join('\n'), [
      'shared struct Ring:',
      '  next: Ring? = none',
    ]);
    expect(findingsIn(source)).toEqual([]);
  });

  it('dispatches a call on an `any` type met by another `any` type without crashing', () => {
    const source = inSubject(
      ['const s: any SubTrait = SubImpl', 'const l: any Linker = s', '_ = l.connect()'].join('\n'),
      [
        'trait SubTrait:',
        '  fn dummy(self: Self) -> Int',
        'struct SubImpl',
        'fn dummy(self: SubImpl) -> Int: 0',
        'trait Linker:',
        '  fn connect(self: Self) -> Int',
        'fn connect(self: any SubTrait) -> Int: self.dummy()',
      ],
    );
    expect(findingsIn(source)).toEqual([]);
  });

  it('keeps sibling handle fields of a struct parameter apart until the caller links them', () => {
    const source = inSubject(
      [
        'const a = new Node{lease: new Lease{n: 1}}',
        'const b = new Node{lease: new Lease{n: 2}}',
        'linkPair(Pair{a, b})',
        'linkPair(Pair{a, b: a})',
      ].join('\n'),
      ['struct Pair { a: Node, b: Node }', 'fn linkPair(p: Pair): p.a->next = p.b'],
    );
    expect(findingsIn(source)).toEqual(['13:call']);
  });

  it('keeps a link directed: what is written gains nothing of what it is written into', () => {
    const source = inSubject(
      [
        'const a = new Node{lease: new Lease{n: 1}}',
        'const b = new Node{lease: new Lease{n: 2}}',
        'const c = new Node{lease: new Lease{n: 3}}',
        'const d = new Node{lease: new Lease{n: 4}}',
        'link(a, d)',
        'link(a, b)',
        'link(d, b)',
        'b->next = c',
      ].join('\n'),
      ['fn link(x: Node, y: Node): x->next = y'],
    );
    expect(findingsIn(source)).toEqual([]);
  });

  // A closure is checked for any values of what it captures where it is made (design.md §5.6).
  it('requires apart of a value written twice only what it may reach', () => {
    const source = inSubject(
      [
        'const n = new Node{lease: new Lease{n: 1}}',
        'const box = new Node{lease: new Lease{n: 2}}',
        'const p = new Node{lease: new Lease{n: 3}, next: box}',
        'storeBoth(p, box, n)',
        'fn save():',
        '  box->next = n',
        'save()',
      ].join('\n'),
      ['fn storeBoth(p: Node, box: Node, n: Node):', '  p->next = n', '  box->next = n'],
    );
    expect(findingsIn(source)).toEqual(['15:closure']);
  });

  it('finds what a function a default calls back does, through the default', () => {
    const source = [
      lease,
      'fn link(a: Node, b: Node = makeNode()):',
      '  a->next = b',
      'fn makeNode() -> Node:',
      '  const x = new Node{lease: new Lease{n: 1}}',
      '  x->next = x',
      '  link(x, x)',
      '  x',
    ].join('\n');
    expect(findingsIn(source)).toEqual(['11:write', '12:call']);
  });

  it('finds what a function a field default calls back does, through the default', () => {
    const source = [
      'shared struct Lease:',
      '  n: Int',
      'fn dispose(self: Lease): ()',
      'shared struct Cell:',
      '  lease: Lease = fresh()',
      '  next: Cell? = none',
      'fn fresh() -> Lease:',
      '  const c = new Cell{}',
      '  c->next = c',
      '  new Lease{n: 1}',
    ].join('\n');
    expect(findingsIn(source)).toEqual(['9:write']);
  });

  it('ends on a recursive default passing a part of an earlier parameter', () => {
    const source = [
      lease,
      'struct Box:',
      '  a: Node',
      '  b: Node',
      '  next: Shared<Box>',
      'fn walk(x: Box, z: Node, y: Int = { x.a->next = z; walk(x.next->value, z, 0) }) -> Int: y',
      'fn use(box: Box):',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  _ = walk(box, n)',
      '  _ = walk(box, box.a)',
    ].join('\n');
    // Its own call is one too: in a recursive group, `x.next->value` is `x`, which reaches `z`.
    expect(findingsIn(source)).toEqual(['11:call', '15:call']);
  });

  it('relates the parts of an input of a recursive group, named whole there', () => {
    const source = inSubject(
      ['const x = new Node{lease: new Lease{n: 1}}', 'linkRec(Pair{a: x, b: x}, 1)'].join('\n'),
      [
        'struct Pair:',
        '  a: Node',
        '  b: Node',
        'fn linkRec(p: Pair, n: Int) -> ():',
        '  p.a->next = p.b',
        '  if n > 0:',
        '    linkRec(p, n - 1)',
      ],
    );
    expect(findingsIn(source)).toEqual(['11:write']);
  });

  it("relates a function's result to what it returns, not to what its defaults give", () => {
    const source = inSubject(
      [
        'const x = new Node{lease: new Lease{n: 0}}',
        'const fresh = makeFresh(x)',
        'x->next = fresh',
      ].join('\n'),
      ['fn makeFresh(a: Node, unused: Node = a) -> Node:', '  new Node{lease: new Lease{n: 1}}'],
    );
    expect(findingsIn(source)).toEqual([]);
  });
});
