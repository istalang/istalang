/**
 * What a type's declaration says its values hold of kinds (proposal 8, Rule 2;
 * types/properties/value-kinds.ts), as the data rule judges it (data-kinds.ts): a type holding both
 * kinds, a field whose default makes data of a kind or holds what its type arguments decide, and a
 * value whose `dispose` is of a mark.
 */

import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { codesOf, reportedMessages, socket } from './kinds.test-kit.ts';

const codes = checkerDiagnostics;

describe('what a type declares it holds', () => {
  it('refuses a type declaration that holds both kinds (Rule 2)', () => {
    expect(codesOf(socket, 'struct Both { s: Socket, slot: Slot<Int> }')).not.toEqual([]);
  });

  it('says a tuple of both kinds holds both, which no code may handle', () => {
    const { messages } = reportedMessages(socket, 'ista fn g(x: (Socket, Slot<Int>)): ()');
    expect(messages.join()).toContain('(Socket, Slot<Int>) holds both kinds of data');
  });

  it("asks for a field's type where its default makes data of a kind, which gives a struct its kind", () => {
    const { codes: found, messages } = reportedMessages(
      'struct Box { slot = Slot.create<Int>() }',
      'ista fn make() -> Box: Box{}',
    );
    expect(found).toContain(codes.unmarkableHolds.code);
    expect(messages.join()).toContain('write the type of the field whose default makes it');
    expect(
      codesOf(
        'struct Box { slot: Slot<Int> = Slot.create<Int>() }',
        'ista fn make() -> Box: Box{}',
      ),
    ).toEqual([]);
  });

  it("asks for a field's type where its default holds a type parameter's values, which may be of a kind", () => {
    const nothing = 'fn nothing<T>() -> T?: none';
    const refused = [codes.defaultTypedFieldKind.code];
    expect(codesOf(nothing, 'struct Holder<T> { item = nothing<T>() }')).toEqual(refused);
    expect(codesOf('struct Made<T is Default> { item = T.default() }')).toEqual(refused);
    expect(codesOf(nothing, 'enum Maybe<T> { Just(item = nothing<T>()), Nothing }')).toEqual(
      refused,
    );
    expect(
      codesOf(
        'type Id<T> = match T:',
        '  case Int: Int',
        '  case _: T',
        'fn nothing<T>() -> Id<T>?: none',
        'struct Matched<T> { item = nothing<T>() }',
      ),
    ).toEqual(refused);
    expect(
      codesOf(
        'fn nothing<S is struct, K in keyof S>() -> S[K]?: none',
        'struct Field<S is struct, K in keyof S> { item = nothing<S, K>() }',
      ),
    ).toEqual(refused);
    const hook = [
      'shared struct Hook<T> { n: Int }',
      'live fn dispose(self: Hook<Int>): ()',
      'fn noHook<T>() -> Hook<T>?: none',
    ];
    expect(codesOf(...hook, 'struct Hooked<T> { h = noHook<T>() }')).toEqual(refused);
    expect(codesOf(...hook, 'struct Hooked<T> { h: Hook<T>? = noHook<T>() }')).toEqual([]);
    expect(codesOf(nothing, 'struct Holder<T> { item: T? = nothing<T>() }')).toEqual([]);
    expect(codesOf('struct Counted<T> { n = 0, take: fn(T) -> Unit }')).toEqual([]);
    expect(codesOf('struct Taker<T> { take = fn(x: T): () }')).toEqual([]);
    expect(
      codesOf('struct Simple<T is Default & DataKind<"simple">> { item = T.default() }'),
    ).toEqual([]);
  });

  it('takes a value its mark-generic `dispose` releases for data of that mark', () => {
    const made = '(f: Fn<(), Unit, M>): _ = new Deferred<M>{run: f}';
    expect(codesOf(`fn makeAndDrop<M in Mark>${made}`)).toEqual([codes.unmarkedHolds.code]);
    expect(codesOf(`M fn makeAndDrop<M in Mark>${made}`)).toEqual([]);
    expect(codesOf('fn later() -> Deferred<"simple">: defer(fn(): ())')).toEqual([]);
  });

  it("reads a type's kinds from its written fields, checking no default to find them", () => {
    expect(
      codesOf(
        socket,
        'trait Tag { fn tag(self: Self) -> Int }',
        'live fn tag(self: A) -> Int: 1',
        'fn takeTag<T is Tag>() -> Int: 0',
        'struct A:',
        '  s: Socket',
        '  x = takeTag<A>()',
      ),
    ).not.toContain(codes.defaultCycle.code);
  });
});
