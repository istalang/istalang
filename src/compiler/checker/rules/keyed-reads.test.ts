/**
 * Keyed reads (§3.9, rules/getters.ts): `x.k` read through an `index` whose key is a member
 * parameter, beside the members of its name, and the shapes of `index` that serve one. Reading and
 * calling them end to end is the corpus's (test/corpus/computed/keyed-members.ista).
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { inFunction, reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

describe('a keyed read (§3.9)', () => {
  const tagged = [
    'struct Tagged:',
    '  name: String',
    'fn index<K in "name" | "id" | "size" | "note">(self: Tagged, key: K) -> String: key',
    'fn get id(self: Tagged) -> String: "id"',
    'fn size(self: Tagged) -> Int: 1',
  ].join('\n');

  it('is a compile error beside a field, a getter or a method of its name, at the use', () => {
    const clash = checkerDiagnostics.keyedOrMember.code;
    const body = [
      'const t = Tagged{name: "a"}',
      '_ = t.name',
      '_ = t.id',
      '_ = t.size',
      '_ = t.size()',
      '_ = t.note',
    ];
    expect(reported(`${tagged}\n\n${inFunction(body.join('\n'))}`)).toEqual({
      codes: [clash, clash, clash, clash],
      spanTexts: ['name', 'id', 'size', 'size'],
    });
  });

  it('is read through an index taking a receiver and a key by value, every other parameter defaulted', () => {
    const declarations = [
      'struct Box:',
      '  n: Int',
      'fn index<K in "a">(self: &Box, key: K) -> Int: 1',
      'struct Trio:',
      '  n: Int',
      'fn index<K in "a">(self: Trio, key: K, extra: Int) -> Int: extra',
    ].join('\n');
    const body = ['const b = Box{n: 1}', 'const t = Trio{n: 1}', '_ = b.a', '_ = t.a'];
    expect(reported(`${declarations}\n\n${inFunction(body.join('\n'))}`)).toEqual({
      codes: [checkerDiagnostics.unknownField.code, checkerDiagnostics.unknownField.code],
      spanTexts: ['a', 'a'],
    });
  });

  it("serves only a receiver meeting its self's struct constraints and member bounds", () => {
    const declarations = [
      'trait Node:',
      '  fn size(self: Self) -> Int',
      'struct Leaf:',
      '  n: Int',
      'fn size(self: Leaf) -> Int: self.n',
      'struct Tree:',
      '  leaf: Leaf',
      'struct Other:',
      '  name: String',
      '  tag: String',
      '  step: fn() -> String',
      '  pick: fn() -> String',
      'fn index<S is struct { [_] is Node }, K in keyof S>(self: S, key: K) -> Int: 1',
      'fn index<S in "x" | "y", K in "k">(self: S, key: K) -> Int: 2',
      'fn get name<S is struct { [_] is Node }>(self: S) -> String: "node"',
      'fn get tag<S in "x" | "y">(self: S) -> String: self',
      'fn step<S is struct { [_] is Node }>(self: S) -> String: "node"',
      'fn pick<S in "x" | "y">(self: S) -> String: self',
    ].join('\n');
    const body = [
      'const f = fn() -> String: "ok"',
      'const o = Other{name: "a", tag: "t", step: f, pick: f}',
      '_ = o.name',
      '_ = o.tag',
      '_ = o.step()',
      '_ = o.pick()',
      '_ = o["name"]',
      '_ = o.k',
      'const t = Tree{leaf: Leaf{n: 1}}',
      '_ = t.leaf',
    ];
    expect(reported(`${declarations}\n\n${inFunction(body.join('\n'))}`)).toEqual({
      codes: [checkerDiagnostics.unknownField.code, checkerDiagnostics.keyedOrMember.code],
      spanTexts: ['k', 'leaf'],
    });
  });

  it("misses list the keys, none for an empty struct's, after a getter whose constraints fail", () => {
    const declarations = [
      'struct Empty',
      'struct Reads<S is struct>:',
      '  m: S',
      'fn index<S is struct, K in keyof S>(self: Reads<S>, key: K) -> S[K]: self.m[key]',
      'struct Held<T>:',
      '  v: T',
      'struct NoText:',
      '  n: Int',
      'fn get shown<T is Stringable>(self: Held<T>) -> String: "x"',
      'fn index<T, K in "a">(self: Held<T>, key: K) -> Int: 1',
    ].join('\n');
    const body = [
      'const r = Reads{m: Empty}',
      'const h = Held{v: NoText{n: 1}}',
      '_ = r.foo',
      '_ = h.shown',
      '_ = h.a',
    ];
    expect(reported(`${declarations}\n\n${inFunction(body.join('\n'))}`)).toEqual({
      codes: [checkerDiagnostics.unknownKey.code, checkerDiagnostics.notConforming.code],
      spanTexts: ['foo', 'h.shown'],
    });
  });

  it('calls the function a per-key read gives, with its own signature and as a deferred call', async () => {
    const declarations = [
      'struct Ops:',
      '  greet: fn(String) -> String',
      '  map: fn(fn(String) -> Int) -> Int',
      '  run: fn(fn() -> String) -> String',
      'struct Client<S is struct>:',
      '  ops: S',
      'fn index<S is struct, K in keyof S>(self: Client<S>, key: K) -> S[K]:',
      '  self.ops[key]',
      'fn word() -> String: "ok"',
    ].join('\n');
    const body = [
      'const c = Client{',
      '  ops: Ops{',
      '    greet: fn(who: String) -> String: `hi ${who}`,',
      '    map: fn(f: fn(String) -> Int) -> Int: f("Ada"),',
      '    run: fn(job: fn() -> String) -> String: job(),',
      '  },',
      '}',
      '`${c.greet("Ada")}|${c.map(fn s: s.length())}|${c.run word()}`',
    ].join('\n');
    expect(await mainGives('String', body, declarations)).toBe('hi Ada|3|ok');
  });
});
