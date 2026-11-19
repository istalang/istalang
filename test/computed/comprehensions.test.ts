/**
 * Comprehensions over a struct's fields (docs/proposals/4-computed-types.md §5, §6; spec §5.2, §10.5):
 * `[for k, v in ...x: e]` builds an array of one element per field, in name order, the elements
 * agreeing on one type; `struct{id, for k, v in ...x: [k]: e}` builds a struct whose fields are the
 * named ones and each of `x`'s, typed from the expected type or else from each pass, evaluating the
 * named fields as written and then the comprehension in name order. Properties hold the commute
 * law: a generic comprehension instantiated, the one over the concrete struct, and the literal
 * written out by hand agree.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../timeouts.ts';
import { codesOf, runMain } from '../written-types.test-kit.ts';
import { generatedFieldsArbitrary } from './computed.test-kit.ts';

const formDeclarations = [
  'trait FormNode:',
  '  type Data',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  'fn validate<T>(self: Field<T>, data: T) -> Array<String>:',
  '  if self.value == none: ["missing"] else: []',
];

/** Runs `lines` as `main`'s body, giving a String. */
async function runText(
  lines: readonly string[],
  declarations: readonly string[],
): Promise<unknown> {
  return await runMain('String', lines.join('\n  '), declarations);
}

describe('an array comprehension over fields', () => {
  it('gives one element per field in name order, agreeing on one type', async () => {
    const declarations = ['struct Misordered { z: Int, a: Int, m: Int }', 'struct Empty'];
    const lines = [
      'const s = Misordered{z: 1, a: 2, m: 3}',
      'const keys = [for k, _ in ...s: k]',
      'const tens: Array<Int> = [for _, v in ...s: v * 10]',
      'const empty = [for k, _ in ...Empty: k]',
      'const optional: Array<Int?> = [for k, v in ...s: if k == "a": none else: v]',
      '`${keys.join(",")}|${tens.map(fn t: `${t}`).join(",")}|${empty.length()}|${optional[1] ?? 0}`',
    ];
    expect(await runText(lines, declarations)).toBe('a,m,z|20,30,10|0|3');
  });

  it('refuses elements that agree on no type, with nothing expected', () => {
    expect(
      codesOf(
        'struct Mixed { s: String, n: Int }',
        'fn f(m: Mixed) -> Int:',
        '  const xs = [for _, v in ...m: v]',
        '  xs.length()',
      ),
    ).toEqual([5301]);
  });
});

describe('elements holding keys', () => {
  it('agree as an array literal of the same values does, each built as the widened type', async () => {
    const declarations = ['struct P { b: Int, a: Int }'];
    const lines = [
      'const pairs = [for k, v in ...P{b: 1, a: 2}: (k, v)]',
      'const ka: "a" = "a"',
      'const kb: "b" = "b"',
      'const written = [(ka, 2), (kb, 1)]',
      'const both: Array<(String, Int)> = [...pairs, ...written]',
      'both.map(fn pair: `${pair.0}${pair.1}`).join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('a2,b1,a2,b1');
  });

  it('agree whatever expressions give the other items, checked once', async () => {
    const declarations = ['struct P { b: Int, a: Int }', 'fn twice(n: Int) -> Int: n * 2'];
    const lines = [
      'const p = P{b: 1, a: 2}',
      'const sums = [for k, v in ...p: (k, v + 1)]',
      'const calls = [for k, v in ...p: (k, twice(v))]',
      'const texts = [for k, v in ...p: (k, `${v}`)]',
      'const ka: "a" = "a"',
      'const kb: "b" = "b"',
      'const written = [(ka, 1 + 1), (kb, 2 + 2)]',
      'const all: Array<(String, Int)> = [...sums, ...calls, ...written]',
      '`${all.map(fn pair: `${pair.0}${pair.1}`).join(",")};${texts.length()}`',
    ];
    expect(await runText(lines, declarations)).toBe('a3,b2,a4,b2,a2,b4;2');
  });

  it('agree over any struct, as the array literal written out per field', {
    timeout: slowTestTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, async (fields) => {
        const struct = `struct S { ${fields.map(({ name, type }) => `${name}: ${type}`).join(', ')} }`;
        const literal = `S{${fields.map(({ name, value }) => `${name}: ${value}`).join(', ')}}`;
        const names = fields.map(({ name }) => name).sort();
        const keys = names.map((name) => `const key${name}: "${name}" = "${name}"`);
        const written = `[${names.map((name) => `(key${name}, 1)`).join(', ')}]`;
        const join = '.map(fn pair: `${pair.0}${pair.1}`).join(",")';
        const expected = names.map((name) => `${name}1`).join(',');
        expect(await runText([`[for k, _ in ...${literal}: (k, 1)]${join}`], [struct])).toBe(
          expected,
        );
        expect(await runText([...keys, `${written}${join}`], [struct])).toBe(expected);
      }),
      { numRuns: 20 },
    );
  });
});

describe('a struct comprehension', () => {
  it('builds structs with and without an expected type, evaluating named fields first', async () => {
    const declarations = [
      ...formDeclarations,
      'struct SettingsForm { retries: Field<Int>, region: Field<String> }',
      'struct Defaults { retries: Int, region: String }',
      'fn current(s: SettingsForm) -> { [F in keyof SettingsForm]: SettingsForm[F].Data? }:',
      '  struct{for field, node in ...s: [field]: node.value}',
      'fn withExpected(d: Defaults) -> Defaults:',
      '  Defaults{for k, v in ...d: [k]: v}',
      'fn withoutExpected(d: Defaults):',
      '  struct{tag: "v1", for k, v in ...d: [k]: v}',
      'fn step(log: &Array<String>, tag: String, v: Int) -> Int:',
      '  log.push(tag)',
      '  v',
    ];
    const lines = [
      'const cur = current(SettingsForm{retries: Field{value: 3}, region: Field{value: none}})',
      'const exp = withExpected(Defaults{retries: 5, region: "eu"})',
      'const inf = withoutExpected(Defaults{retries: 7, region: "us"})',
      'let log: Array<String> = []',
      'const built = struct{',
      '  z: step(&log, "named-z", 9),',
      '  first: step(&log, "named-first", 0),',
      '  for k, v in ...struct{m: 30, a: 20}: [k]: step(&log, `comp-${k}`, v)',
      '}',
      'const parts = [`${cur.retries ?? -1}:${cur.region ?? "none"}`, `${exp.retries}:${exp.region}`]',
      '`${parts.join("|")}|${inf.tag}:${inf.retries}|${log.join(",")}|${built.a}:${built.m}:${built.z}`',
    ];
    expect(await runText(lines, declarations)).toBe(
      '3:none|5:eu|v1:7|named-z,named-first,comp-a,comp-m|20:30:9',
    );
  });

  it('builds a mapped struct type over a constrained type parameter, generically', async () => {
    const declarations = [
      ...formDeclarations,
      'fn current<S is struct { [_]: Field<Int> }>(s: S) -> { [F in keyof S]: S[F].Data? }:',
      '  struct{for field, node in ...s: [field]: node.value}',
    ];
    const lines = [
      'const cur = current(struct{b: Field<Int>{value: 1}, a: Field<Int>{value: none}})',
      '`${cur.a ?? -1}:${cur.b ?? 0}`',
    ];
    expect(await runText(lines, declarations)).toBe('-1:1');
  });

  it('refuses fields given twice, unknown or missing, and fields not all known without a type', () => {
    const lines = [
      'struct Defaults { retries: Int, region: String }',
      'struct Other { a: Int }',
      'fn noExpected<S is struct>(s: S):',
      '  const out = struct{for k, v in ...s: [k]: v}',
      '  _ = out',
      'fn twice(d: Defaults) -> Defaults:',
      '  Defaults{retries: 1, for k, v in ...d: [k]: v}',
      'fn unknown(o: Other) -> Defaults:',
      '  Defaults{for k, v in ...o: [k]: v}',
      'fn other<S is struct>(s: S) -> { [F in keyof S]: S[F] }:',
      '  struct{extra: 1, for k, v in ...s: [k]: v}',
      'fn fewer<S is struct { title: String }>(s: S) -> { [F in keyof S]: S[F] }:',
      '  struct{for k, v in ...s: [k]: v, title: s.title}',
    ];
    expect(codesOf(...lines).toSorted()).toEqual([2032, 5013, 5013, 5014, 5014, 5015, 5015, 5167]);
  });

  it('refuses brackets naming anything but its key', () => {
    expect(
      codesOf(
        'struct Defaults { retries: Int, region: String }',
        'fn wrongKey(d: Defaults) -> Defaults:',
        '  Defaults{for k, v in ...d: [v]: v}',
      ),
    ).toContain(2033);
  });
});

describe('the commute law of a struct comprehension', () => {
  it('agrees: generic and instantiated, over the concrete struct, and written out by hand', {
    timeout: slowTestTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, async (fields) => {
        const declared = fields.map((field) => `${field.name}: ${field.type}`).join(', ');
        const value = `Generated{${fields.map((field) => `${field.name}: ${field.value}`).join(', ')}}`;
        const byHand = fields.map((field) => `${field.name}: s.${field.name}`).join(', ');
        const declarations = [
          `struct Generated { ${declared} }`,
          'fn generic<S is struct>(s: S) -> { [F in keyof S]: S[F] }:',
          '  struct{for k, v in ...s: [k]: v}',
          'fn concrete(s: Generated) -> Generated:',
          '  Generated{for k, v in ...s: [k]: v}',
          'fn shaped(s: Generated):',
          '  struct{for k, v in ...s: [k]: v}',
          `fn byHand(s: Generated) -> Generated: Generated{${byHand}}`,
          'fn keys<S is struct { [_] is Stringable }>(s: S) -> String:',
          '  [for k, v in ...s: `${k}=${v}`].join(",")',
        ];
        const lines = [
          `const s = ${value}`,
          'const g = generic(s)',
          '`${g == s}|${concrete(s) == s}|${byHand(s) == s}|${keys(g)}|${keys(shaped(s))}`',
        ];
        const visited = fields
          .toSorted((first, second) => (first.name < second.name ? -1 : 1))
          .map((field) => `${field.name}=${field.value.replaceAll('"', '')}`)
          .join(',');
        expect(await runText(lines, declarations)).toBe(`true|true|true|${visited}|${visited}`);
      }),
      { numRuns: 15 },
    );
  });

  it('evaluates the named fields as written, then the comprehension in name order', {
    timeout: slowTestTimeout,
  }, async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, fc.nat(), async (fields, cut) => {
        const named = fields.slice(0, cut % (fields.length + 1));
        const comprehended = fields.slice(named.length);
        const logged = (field: { readonly name: string }) =>
          `${field.name}: step(&log, "${field.name}")`;
        const source = `struct{${comprehended.map(logged).join(', ')}}`;
        const items = [
          ...named.map(logged),
          `for k, _ in ...${source}: [k]: step(&log, \`comp-\${k}\`)`,
        ];
        const declarations = [
          'fn step(log: &Array<String>, tag: String) -> Int:',
          '  log.push(tag)',
          '  0',
        ];
        const lines = [
          'let log: Array<String> = []',
          `_ = struct{${items.join(', ')}}`,
          'log.join(",")',
        ];
        const expected = [
          ...named.map((field) => field.name),
          ...comprehended.map((field) => field.name),
          ...comprehended.map((field) => `comp-${field.name}`).toSorted(),
        ];
        expect(await runText(lines, declarations)).toBe(expected.join(','));
      }),
      { numRuns: 15 },
    );
  });
});
