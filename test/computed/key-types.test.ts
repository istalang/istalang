/**
 * Key types (docs/proposals/4-computed-types.md §8): `keyof S`, `S[K]`, `keyof {}` as `Never`, the
 * precedence of `.Name`, `[K]` and `?` over `keyof` and `|`, `a < b[c] > (d)` read as a call, `s[k]`
 * read before any `index`, a single key as a place (written, compound-assigned, passed by `&`, the
 * receiver of a method taking `&self`), writes through several keys converting into each field,
 * and what a key may not do.
 */

import { describe, expect, it } from 'vitest';
import { codesOf, compareWrittenTypes, runMain, sameComputedType } from './computed.test-kit.ts';

describe('key types: `keyof S`, `S[K]`, `s[k]`, and `Entry` / `AnyEntry` (§8)', () => {
  const keyDecls = [
    'struct Empty',
    'struct Settings { retries: Int; region: String }',
    'struct Nested { inner: Settings }',
  ];

  it('computes `keyof S`, `S[K]`, `keyof {}` as `Never`, and binds `.Name`, `[K]` and `?` tighter than `keyof` and `|`', () => {
    expect(compareWrittenTypes('keyof Settings', '"retries" | "region"', keyDecls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('keyof Empty', 'Never', keyDecls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('keyof {}', 'Never', keyDecls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Settings["retries"]', 'Int', keyDecls)).toEqual(sameComputedType);
    expect(compareWrittenTypes('Settings[keyof Settings]', 'Int | String', keyDecls)).toEqual(
      sameComputedType,
    );
    // Precedence: `keyof Nested["inner"]` is `keyof (Nested["inner"])`
    expect(compareWrittenTypes('keyof Nested["inner"]', '"retries" | "region"', keyDecls)).toEqual(
      sameComputedType,
    );
    expect(compareWrittenTypes('Settings["retries"]?', 'Int | None', keyDecls)).toEqual(
      sameComputedType,
    );
  });

  it('parses `a < b[c] > (d)` as a call with type argument `b[c]` (§3.5)', () => {
    expect(
      runMain('Int', 'id<Settings["retries"]>(42)', [...keyDecls, 'fn id<T>(x: T) -> T: x']),
    ).toBe(42);
  });

  it('reads `s[k]` before any `index` when `K` is within `keyof S`, and calls `index` on `s["field"]` when `S` declares `index`', () => {
    const decls = [
      ...keyDecls,
      'struct WithIndex { region: String }',
      'fn index(self: WithIndex, k: String) -> String: `indexed:${k}`',
      'fn readKey(s: Settings, k: keyof Settings) -> Int | String: s[k]',
    ];
    expect(
      runMain(
        'String',
        [
          'const s = Settings{retries: 3, region: "eu"}',
          'const r1 = s["region"]',
          'const r2 = match readKey(s, "retries"):',
          '  case Int as n: String(n)',
          '  case str: str',
          'const w = WithIndex{region: "us"}',
          // `w` has `index(WithIndex, String)`, so `"region"` infers as `String` and calls `index`
          'const viaIndex = w["region"]',
          // `k` has literal type `"region"` (within `keyof WithIndex`), so `w[k]` reads the field!
          'const k: "region" = "region"',
          'const viaField = w[k]',
          '`${r1}|${r2}|${viaIndex}|${viaField}`',
        ].join('\n  '),
        decls,
      ),
    ).toBe('eu|3|indexed:region|us');
  });

  it('treats `s[k]` with a single key as a place (write, `+=`, `&s[k]` including to async fns, and `&self` methods), and supports multi-key writes', () => {
    const decls = [
      'struct Lists { a: Array<Int>; b: Array<Int> }',
      'struct Widened { a: Int?; b: Int | String }',
      'struct Counts { x: Int; y: Int }',
      'async fn bumpAsync(target: &Int):',
      '  await runtime.commit()',
      '  target += 10',
      'fn mutateKey<S is struct, K in keyof S>(s: &S, k: K, v: S[K]):',
      '  s[k] = v',
    ];
    expect(
      runMain(
        'String',
        [
          'let counts = Counts{x: 1, y: 2}',
          'await bumpAsync(&counts["x"])',
          'const kAll: keyof Counts = "y"',
          'counts[kAll] += 5',
          'let lists = Lists{a: [1], b: []}',
          'lists["a"].push(2)',
          'mutateKey(&lists, "b", [9])',
          'let w = Widened{a: none, b: "init"}',
          'const kw: keyof Widened = "a"',
          'w[kw] = 42',
          '`${counts.x}:${counts.y}|${lists.a.length()}:${lists.b[0]}|${w.a ?? 0}`',
        ].join('\n  '),
        ["import * as runtime from 'runtime'", ...decls],
      ),
    ).toBe('11:7|2:9|42');
  });

  it('rejects `&s[k]` and `&self` methods on a multi-key union, multi-key writes that do not fit every field, and `+=` on mixed-type keys', () => {
    expect(
      codesOf(
        ...keyDecls,
        'fn takeRef(r: &(Int | String)): ()',
        'fn badRef(s: Settings, k: keyof Settings):',
        '  let m = s',
        '  takeRef(&m[k])',
      ).length,
    ).toBeGreaterThan(0);

    expect(
      codesOf(
        'struct Lists { a: Array<Int>; b: Array<Int> }',
        'fn badMethodRef(s: Lists, k: keyof Lists):',
        '  let m = s',
        '  m[k].push(1)',
      ).length,
    ).toBeGreaterThan(0);

    expect(
      codesOf(
        ...keyDecls,
        'fn badMultiWrite(s: Settings, k: keyof Settings):',
        '  let m = s',
        '  m[k] = 10',
      ).length,
    ).toBeGreaterThan(0);

    expect(
      codesOf(
        ...keyDecls,
        'fn badCompound(s: Settings, k: keyof Settings):',
        '  let m = s',
        '  m[k] += 1',
      ).length,
    ).toBeGreaterThan(0);
  });

  it('reads and writes `S[K]` for a key of several fields as their one exact type, else opaque', () => {
    const declarations = [
      'trait Shown:',
      '  fn show(self: Self) -> String',
      'fn member<T is struct { a: Int; [_]: Int }, K in keyof T>(t: &T, k: K) -> Int:',
      '  t[k] += 1',
      '  t[k]',
      'fn union<T is struct { a: Int; [_]: Int }>(t: T, k: keyof T) -> Int:',
      '  t[k]',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(
      runMain('Int', 'both(P{a: 1, b: 5})', [
        ...declarations,
        'struct P { a: Int; b: Int }',
        'fn both(given: P) -> Int:',
        '  let p = given',
        '  member(&p, "b") + union(p, "a")',
      ]),
    ).toBe(7);
    expect(
      codesOf(
        ...declarations,
        'fn opaque<T is struct { a: Int; [_] is Shown }, K in keyof T>(t: T, k: K) -> Int:',
        '  t[k]',
      ),
    ).toEqual([5001]);
  });

  it('reports an entry no member of `AnyEntry` takes as not fitting it, once', () => {
    expect(
      codesOf(
        'struct Settings { retries: Int; region: String }',
        'struct Entry<S is struct, K in keyof S> { key: K; value: S[K] }',
        'type AnyEntry<S is struct> = { [K in keyof S]: Entry<S, K> }[keyof S]',
        'fn f() -> Int:',
        '  const c: AnyEntry<Settings> = Entry{key: "region", value: 3}',
        '  1',
      ),
    ).toEqual([5001]);
  });

  it('runs the `Entry` / `AnyEntry` example: a union of entries applies through the trait its members meet', () => {
    expect(
      runMain(
        'String',
        [
          'let settings = Settings{retries: 1, region: "us"}',
          'const e1: AnyEntry<Settings> = Entry{key: "region", value: "eu"}',
          'const e2: AnyEntry<Settings> = Entry{key: "retries", value: 5}',
          'e1.apply(&settings)',
          'e2.apply(&settings)',
          '`${settings.region}:${settings.retries}`',
        ].join('\n  '),
        [
          ...keyDecls,
          'struct Entry<S is struct, K in keyof S> { key: K; value: S[K] }',
          'type AnyEntry<S is struct> = { [K in keyof S]: Entry<S, K> }[keyof S]',
          'trait Applies<S>:',
          '  fn apply(self: Self, target: &S)',
          'fn apply<S is struct, K in keyof S>(self: Entry<S, K>, target: &S):',
          '  target[self.key] = self.value',
        ],
      ),
    ).toBe('eu:5');
  });
});
