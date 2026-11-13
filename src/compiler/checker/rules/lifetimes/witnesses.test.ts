/**
 * The witnesses a call can't name where it is made (design.md §5.4): put into an `any`, named as a
 * function value, or known only to an instantiation. Each program here closes a cycle through a
 * disposable when run, so each must be found somewhere: where the value goes in, where the
 * function is named, or where the generic function putting it in is called.
 */

import { describe, expect, it } from 'vitest';
import { findingsIn } from './lifetimes.test-kit.ts';

const lease = ['shared struct Lease:', '  n: Int', 'fn dispose(self: Lease): ()'];

/** The lines of a program, the lease declarations first. */
function program(...lines: readonly string[]): string {
  return [...lease, ...lines].join('\n');
}

describe('witnesses checked where they escape', () => {
  it('finds a generic witness writing its argument in, its types as instantiated', () => {
    const source = program(
      'shared struct Box<T>:',
      '  lease: Lease',
      '  value: T? = none',
      'shared struct Node:',
      '  box: Box<Node>',
      'trait Setter<V>:',
      '  fn putIn(self: Self, v: V)',
      'fn putIn<T>(self: Box<T>, v: T):',
      '  self->value = v',
      'ista fn subject():',
      '  const b = new Box<Node>{lease: new Lease{n: 1}}',
      '  const n = new Node{box: b}',
      '  const s: any Setter<Node> = b',
      '  s.putIn(n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a generic function named as a value, its types as instantiated', () => {
    const source = program(
      'shared struct Box<T>:',
      '  lease: Lease',
      '  value: T? = none',
      'shared struct Node:',
      '  box: Box<Node>',
      'fn putIn<T>(self: Box<T>, v: T):',
      '  self->value = v',
      'ista fn subject():',
      '  const b = new Box<Node>{lease: new Lease{n: 1}}',
      '  const n = new Node{box: b}',
      '  const f = putIn<Node>',
      '  f(b, n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a witness writing into a handle its parameter reaches', () => {
    const source = program(
      'shared struct Inner:',
      '  lease: Lease',
      '  next: Inner? = none',
      'shared struct Outer:',
      '  inner: Inner',
      'fn getInner(o: Outer) -> Inner:',
      '  o->inner',
      'trait Bad:',
      '  fn linkOuter(self: Self, x: Inner)',
      'fn linkOuter(self: Outer, x: Inner):',
      '  getInner(self)->next = x',
      'ista fn subject():',
      '  const i = new Inner{lease: new Lease{n: 1}}',
      '  const o = new Outer{inner: i}',
      '  const b: any Bad = o',
      '  b.linkOuter(i)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a generic value put into an any, where the generic function is called', () => {
    const source = program(
      'shared struct Node:',
      '  lease: Lease',
      '  next: Node? = none',
      'struct Box<T>:',
      '  node: Node',
      '  extra: T',
      'trait Bad:',
      '  fn tie(self: Self, other: Node)',
      'fn tie<T>(self: Box<T>, other: Node):',
      '  self.node->next = other',
      'fn erase<T>(b: Box<T>) -> any Bad:',
      '  b',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  const e = erase(Box{node: n, extra: 0})',
      '  e.tie(n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a value put into an any by a destructuring assignment', () => {
    const source = program(
      'shared struct Node:',
      '  lease: Lease',
      '  next: Node? = none',
      'struct Holder:',
      '  item: Node',
      'trait Bad:',
      '  fn tie(self: Self, other: Node)',
      'fn tie(self: Node, other: Node):',
      '  self->next = other',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  const h = Holder{item: n}',
      '  let b: (any Bad)? = none',
      '  Holder{item: b} = h',
      '  b?.tie(n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });
});

describe('requirement calls whose witnesses only an instantiation names', () => {
  const bad = [
    'shared struct Node:',
    '  lease: Lease',
    '  next: Node? = none',
    'struct Good:',
    '  n: Int',
    'trait Bad:',
    '  fn tie(self: Self, other: Node)',
    'fn tie(self: Node, other: Node):',
    '  self->next = other',
    'fn tie(self: Good, other: Node): ()',
  ];

  it('finds a call on a struct constraint field, where the generic function is called', () => {
    const source = program(
      ...bad,
      'struct Holder:',
      '  f: Node',
      'fn actField<S is struct { f is Bad }>(s: S, other: Node):',
      '  s.f.tie(other)',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  actField(Holder{f: n}, n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a call on an associated type, where the generic function is called', () => {
    const source = program(
      ...bad,
      'trait HasData:',
      '  type Data is Bad',
      'struct Source:',
      '  type Data = Node',
      'fn actAssoc<T is HasData>(x: T.Data, other: Node):',
      '  x.tie(other)',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  actAssoc<Source>(n, n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a call on a union holding a type parameter, its known member at once', () => {
    const source = program(
      ...bad,
      'fn actUnion<T is Bad>(x: Node | T, other: Node):',
      '  x.tie(other)',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  actUnion<Good>(n, n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a generic call whose type argument is a union meeting the trait member by member', () => {
    const source = program(
      ...bad,
      'fn act<T is Bad>(x: T, other: Node):',
      '  x.tie(other)',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  const x: Node | Good = n',
      '  act(x, n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('finds a generic value put into an any where the call makes it a union', () => {
    const source = program(
      ...bad,
      'fn erase<T is Bad>(x: T) -> any Bad:',
      '  x',
      'ista fn subject():',
      '  const n = new Node{lease: new Lease{n: 1}}',
      '  const x: Node | Good = n',
      '  erase(x).tie(n)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });
});

describe('parts and handles related soundly', () => {
  it('finds two parts of one input of different handle types linked in a recursive function', () => {
    const source = program(
      'shared struct Node:',
      '  lease: Lease',
      '  box: Box? = none',
      'shared struct Box:',
      '  node: Node? = none',
      'struct Pair:',
      '  a: Box',
      '  b: Node',
      'fn linkRec(p: Pair, n: Int) -> ():',
      '  p.a->node = p.b',
      '  if n > 0: linkRec(p, n - 1)',
      'ista fn subject():',
      '  const b = new Box{}',
      '  const node = new Node{lease: new Lease{n: 1}, box: b}',
      '  linkRec(Pair{a: b, b: node}, 1)',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });

  it('relates two values that only may alias after code nobody sees', () => {
    const source = program(
      'shared struct Node:',
      '  lease: Lease',
      '  next: Node? = none',
      'ista fn subject(cond: Bool, unseen: ista fn(Node, Node) -> ()):',
      '  const a = new Node{lease: new Lease{n: 1}}',
      '  const b = if cond: a else: new Node{lease: new Lease{n: 2}}',
      '  unseen(a, b)',
      '  const next = a->next',
      '  b->next = next',
    );
    expect(findingsIn(source)).not.toEqual([]);
  });
});
