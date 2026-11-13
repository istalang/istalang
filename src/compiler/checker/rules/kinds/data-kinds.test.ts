/**
 * The data rule over a body (proposal 8, Rule 2, data-kinds.ts): every value a function handles,
 * its locals, captures, bindings, the type arguments of its calls and each field loop's passes, held
 * to its mark; what a type's declaration says it holds is declared-kinds.test.ts'.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { codesOf, liveResource, socket } from './kinds.test-kit.ts';

const codes = checkerDiagnostics;

describe('the data rule over a body', () => {
  it('judges the cursor a loop calls as a call', () => {
    const source = [
      'struct B { n: Int }',
      'fn iterate(self: B) -> live fn() -> Step<Int>: live fn(): Step.Done',
      'ista fn main(b: B):',
      '  for x in b: _ = x',
    ];
    expect(codesOf(...source)).toEqual([codes.kindsMeet.code]);
  });

  it("gives a struct's defaults and a variant's constructor the kind of what they make", () => {
    const source = [
      "import Inbox from 'inbox'",
      'shared struct Box { inbox: Inbox<Int> = Inbox.create<Int>() }',
      'ista fn make() -> Box: new Box{}',
    ];
    expect(codesOf(...source)).toEqual([]);
    expect(codesOf(...source.slice(0, 2), 'fn make() -> Box: new Box{}')).toContain(
      codes.unmarkedHolds.code,
    );
  });

  it('takes a slot for ista data, by its runtime `dispose`', () => {
    expect(codesOf('fn hold(s: Slot<Int>): ()')).toEqual([codes.unmarkedHolds.code]);
    expect(codesOf('ista fn hold(s: Slot<Int>): ()')).toEqual([]);
  });

  it("judges a lambda's captures as values its body handles", () => {
    const source = [
      socket,
      'live fn close(self: Socket): ()',
      'live fn main(s: Socket) -> fn() -> Unit: fn(): s.close()',
    ];
    expect(codesOf(...source)).not.toEqual([]);
    expect(
      codesOf(
        ...source.slice(0, 2),
        'live fn main(s: Socket) -> live fn() -> Unit: fn(): s.close()',
      ),
    ).toEqual([]);
  });

  it('reports one value per function, the first it handles', () => {
    const source = [socket, 'extern live fn get() -> Socket', 'fn f(): _ = (get(), get())'];
    expect(codesOf(...source).filter((code) => code === codes.unmarkedHolds.code)).toHaveLength(1);
  });
});

describe('what a body handles', () => {
  it("judges the types a requirement's call is read through, its `Self` among them (Rule 3)", () => {
    const source = [
      ...liveResource,
      'trait Action { fn Self.act() -> Int }',
      'live fn LiveResource.act() -> Int: 1',
      'trait HasActor { type Actor is Action & DataKind<"live" | "simple"> }',
    ];
    expect(codesOf(...source, 'fn trigger<X is HasActor>() -> Int: X.Actor.act()')).toEqual([
      codes.unmarkedHolds.code,
    ]);
    expect(codesOf(...source, 'live fn trigger<X is HasActor>() -> Int: X.Actor.act()')).toEqual(
      [],
    );
  });

  it("judges a local function's body and a top-level constant's lambda by the data rule", () => {
    expect(
      codesOf(
        socket,
        'live fn outer(s: Socket) -> fn() -> Unit:',
        '  fn inner():',
        '    const copy = s',
        '    ()',
        '  inner',
      ),
    ).toEqual([codes.unmarkedHolds.code]);
    expect(
      codesOf(
        socket,
        'live fn outer(s: Socket) -> ista fn() -> Unit:',
        '  ista fn inner():',
        '    const copy = s',
        '    ()',
        '  inner',
      ),
    ).toEqual([codes.kindsHeld.code]);
    expect(
      codesOf(
        socket,
        'struct Hold { s: Socket? }',
        'const bad = ista fn(): { const h = Hold{s: none}; () }',
      ),
    ).toEqual([codes.kindsHeld.code]);
  });

  it('judges local variables, union wraps and captured reassignments by the data rule', () => {
    expect(codesOf(socket, 'ista fn a(): { const held: Socket? = none; () }')).toEqual([
      codes.kindsHeld.code,
    ]);
    expect(codesOf(socket, 'ista fn b(): { const held: Socket | Int = 1; () }')).toEqual([
      codes.kindsHeld.code,
    ]);
    expect(
      codesOf(
        socket,
        'live fn makeIstaClear(s: Socket) -> ista fn() -> Unit:',
        '  let x: Socket? = s',
        '  ista fn(): { x = none; () }',
      ),
    ).toEqual([codes.kindsHeld.code]);
  });

  it('handles deferred calls of function values, parenthesized calls, mark-generic callees and captured data', () => {
    expect(
      codesOf(
        'ista fn runJob(j: sendable live async fn() -> Int): ()',
        'ista fn main(charge: sendable live async fn(Int) -> Int): runJob charge(10)',
      ),
    ).toEqual([]);
    // A parenthesized call is no deferred call: it is made now, an argument.
    expect(
      codesOf(
        'live async fn charge(a: Int) -> Int: a',
        'ista fn runJob(j: sendable live async fn() -> Int): ()',
        'ista fn main(): runJob (charge(10))',
      ),
    ).toContain(codes.kindsMeet.code);
    // A deferred call's callee takes no mark from its taker's parameter yet: one is written.
    expect(
      codesOf(
        'K async fn work<K in Persistence>(x: Int) -> Int: x',
        'fn queueUp(j: ista async fn() -> Int): _ = j',
        'fn helper(x: Int): queueUp work<"ista">(x)',
      ),
    ).toEqual([]);
    expect(
      codesOf(
        socket,
        'fn touch<T>(x: T): ()',
        'fn asIsta(f: ista fn() -> Unit) -> ista fn() -> Unit: f',
        'live fn makeIsta(s: Socket) -> ista fn() -> Unit: asIsta touch(s)',
      ),
    ).not.toEqual([]);
  });
});

describe('the data rule beside layouts, passes and instantiations', () => {
  it("reads no struct's layout while one of its defaults is being checked", () => {
    expect(codesOf('fn useA(a: A): ()', 'struct A { x: Int = 1, f = fn(a: A) -> Int: 1 }')).toEqual(
      [],
    );
  });

  it('judges what a field loop computes in each of its passes', () => {
    const source = [
      socket,
      'fn empty<T>() -> Array<T>: []',
      'struct Pair { a: Int, b: String }',
      'fn f(p: Pair):',
      '  for k, v in ...p:',
      '    const xs = empty<Socket>()',
      '    _ = (k, v, xs)',
    ];
    expect(codesOf(...source)).toContain(codes.unmarkedHolds.code);
  });

  it('judges the type arguments a call instantiates, which its values may not show', () => {
    const source = [
      socket,
      'fn makeEmpty<T>() -> Int:',
      '  const xs: Array<T> = []',
      '  xs.length()',
      'ista fn main() -> Int: makeEmpty<Socket>()',
    ];
    expect(codesOf(...source)).toContain(codes.kindsHeld.code);
  });

  it('reads a computed field type as each instantiation reduces it', () => {
    const source = [
      socket,
      'type Unwrap<T> = match T:',
      '  case Int: Socket',
      '  case _: Int',
      'struct Wrapper<T> { value: Unwrap<T> }',
      'fn f(w: Wrapper<Int>): ()',
    ];
    expect(codesOf(...source)).toContain(codes.unmarkedHolds.code);
  });

  it('judges parts conversions and unnamed declarations holding data of the other kind', () => {
    expect(
      codesOf(
        socket,
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  const t = (1, none)',
        '  const _: (Int, Socket?) = t',
        '  0',
      ),
    ).toEqual([codes.kindsHeld.code]);
    expect(
      codesOf(
        socket,
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int:",
        '  const _: Socket = panic("boom")',
        '  0',
      ),
    ).toEqual([codes.kindsHeld.code]);
  });

  it("refuses a generic call whose constraints' witnesses handle the other kind", () => {
    expect(
      codesOf(
        ...liveResource,
        'struct Phantom<T> { tag: Int }',
        'fn Phantom.default<T is Default>() -> Phantom<T>:',
        '  const x = T.default()',
        '  Phantom<T>{tag: 0}',
        'fn createAndDrop<P is Default>() -> P: P.default()',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: createAndDrop<Phantom<LiveResource>>().tag",
      ),
    ).not.toEqual([]);
  });

  it("infers a lambda's mark from every value its body handles, a struct holding a kind among them", () => {
    const holder = [socket, 'struct Holder { s: Socket }'];
    expect(codesOf(...holder, 'fn main():', '  const f = fn(h: Holder): 1', '  _ = f')).toEqual([]);
    expect(
      codesOf(...holder, 'live fn main(h: Holder):', '  const f = fn(): h', '  _ = f'),
    ).toEqual([]);
    expect(
      codesOf(socket, 'live fn outer(s: Socket):', '  const f = fn(): live fn(): s', '  _ = f'),
    ).toEqual([]);
    expect(
      codesOf(
        socket,
        'fn makeEmpty<T>() -> Int: 0',
        'live fn main():',
        '  const f = fn(): makeEmpty<Socket>()',
        '  _ = f',
      ),
    ).toEqual([]);
    expect(
      codesOf(
        socket,
        'live fn main():',
        '  const f = fn(): { const s: Socket? = none; 0 }',
        '  _ = f',
      ),
    ).toEqual([]);
  });

  it("gives a deferred call's function a lambda's mark, the code's around it where its taker's is open", () => {
    const keep = [
      'live fn liveThing(): ()',
      'fn keep<M in Mark>(f: Fn<(), Unit, M>) -> Fn<(), Unit, M>: f',
    ];
    expect(codesOf(...keep, 'fn s(): _ = keep liveThing()')).toEqual([codes.kindsMeet.code]);
    expect(codesOf(...keep, 'fn s(): _ = keep(fn(): liveThing())')).toEqual([
      codes.unmarkedCalls.code,
    ]);
    expect(codesOf(...keep, 'live fn s(): _ = keep liveThing()')).toEqual([]);
  });

  it("judges what a deferred call computes now in the code around it, however its call's scope settles", () => {
    const keeping = [
      socket,
      'live fn liveId(s: Socket) -> Int: 0',
      'fn consume(n: Int): ()',
      'fn keep<M in Mark>(f: Fn<(), Unit, M>) -> Fn<(), Unit, M>: f',
    ];
    expect(
      codesOf(...keeping, 'live fn t(s: Socket) -> fn() -> Unit: keep consume(liveId(s))'),
    ).toEqual([]);
  });

  it("refuses a deferred call's function holding a kind as simple code, which no head can mark", () => {
    const source = [
      socket,
      'fn touch<T>(x: T): ()',
      'fn keep(f: fn() -> Unit): f()',
      'live fn t(s: Socket): keep touch(s)',
    ];
    expect(codesOf(...source)).toEqual([codes.unmarkableHolds.code]);
  });

  it('refuses a deferred call capturing a struct of a kind into a function of the other', () => {
    expect(
      codesOf(
        socket,
        'struct Holder { s: Socket }',
        'fn touch<T>(x: T): ()',
        'fn asIsta(f: ista fn() -> Unit) -> ista fn() -> Unit: f',
        'live fn makeIsta(h: Holder) -> ista fn() -> Unit: asIsta touch(h)',
      ),
    ).not.toEqual([]);
  });

  it('refuses a struct holding a kind even when its fields reach a constrained dispose on it', () => {
    expect(
      codesOf(
        socket,
        'trait Tag { fn tag(self: Self) -> Int }',
        'live fn tag(self: A) -> Int: 1',
        'shared struct Box<T> { value: T }',
        'fn dispose<T is Tag>(self: Box<T>): ()',
        'struct A { s: Socket, b: Box<A>? }',
        'fn bad(a: A): ()',
        'ista fn worse(a: A): ()',
      ),
    ).toEqual([codes.unmarkedHolds.code, codes.kindsHeld.code]);
  });

  it('infers a simple mark for a lambda whose body only defers a call of a kind', () => {
    expect(
      codesOf(
        'live async fn charge(a: Int) -> Int: a',
        'fn runJob(j: sendable live async fn() -> Int): ()',
        'ista fn outer() -> fn() -> Unit:',
        '  const f = fn(): runJob charge(10)',
        '  f',
      ),
    ).toEqual([]);
  });

  it('refuses a deferred call or function value whose generic instantiation handles the other kind', () => {
    expect(
      codesOf(
        ...liveResource,
        'fn createAndDrop<T is Default>() -> Int:',
        '  const x = T.default()',
        '  0',
        'fn runSimple(f: fn() -> Int) -> Int: f()',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: runSimple createAndDrop<LiveResource>()",
      ),
    ).not.toEqual([]);
    expect(
      codesOf(
        socket,
        'fn makeEmpty<T>() -> Int:',
        '  const xs: Array<T> = []',
        '  xs.length()',
        'fn runSimple(f: fn() -> Int) -> Int: f()',
        "import * as runtime from 'runtime'\nlive async fn main() -> Int: await runtime.run(runtime.id()) _main()\nista async fn _main() -> Int: runSimple makeEmpty<Socket>()",
      ),
    ).not.toEqual([]);
    expect(
      codesOf(
        ...liveResource,
        'fn createAndDrop<T is Default>() -> Int:',
        '  const x = T.default()',
        '  0',
        'live fn makeSimple() -> fn() -> Int: createAndDrop<LiveResource>',
      ),
    ).not.toEqual([]);
  });
});
