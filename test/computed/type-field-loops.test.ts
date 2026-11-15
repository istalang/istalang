/**
 * Field loops over a type (docs/proposals/17-type-field-loops.md, spec §4): `for K in keyof S` runs
 * once per field of `S` with no value to read, `K` a member parameter the loop declares, read as
 * its key's value; static functions are called through `S[K]`; and every member parameter over
 * literal types reads as its value (§3.5).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { codesOf, hoverCodeAt, runMain } from '../written-types.test-kit.ts';
import { generatedFieldsArbitrary } from './computed.test-kit.ts';

/** Runs `lines` as `main`'s body, giving a String, after `declarations`. */
async function runText(
  lines: readonly string[],
  declarations: readonly string[],
): Promise<unknown> {
  return await runMain('String', lines.join('\n  '), declarations);
}

const orderLike = ['struct OrderLike { country: String, qty: Int, city: String }'];

describe('a loop over a type', () => {
  it("runs once per field, in name order, its key the field's name", async () => {
    const lines = [
      'let names: Array<String> = []',
      'for K in keyof OrderLike:',
      '  names.push(K)',
      'names.join(",")',
    ];
    expect(await runText(lines, orderLike)).toBe('city,country,qty');
  });
});

const nodes = [
  'trait Node:',
  '  fn Self.make(seed: Int) -> Self',
  'struct Leaf:',
  '  value: Int',
  'fn Leaf.make(seed: Int) -> Leaf: Leaf{value: seed}',
  'struct Group<S is struct { [_] is Node }>:',
  '  fields: S',
  'fn Group.make<S is struct { [_] is Node }>(seed: Int) -> Group<S>:',
  '  Group{fields: struct{for K in keyof S: [K]: S[K].make(seed)}}',
  'struct Inner { x: Leaf, y: Leaf }',
  'struct Model { a: Leaf, inner: Group<Inner> }',
];

describe('a struct comprehension over a type', () => {
  it('builds a nested model from its type, through static functions on S[K]', async () => {
    const lines = [
      'const model: Group<Model> = Group.make(7)',
      '`${model.fields.a.value},${model.fields.inner.fields.y.value}`',
    ];
    expect(await runText(lines, nodes)).toBe('7,7');
  });
});

describe('a loop over a type is a field loop', () => {
  it("reads a value's fields by its key, in each pass that field's type", async () => {
    const declarations = ['struct Point { y: Int, x: Int }'];
    const lines = [
      'const p = Point{y: 2, x: 1}',
      'const bumped: Point = struct{for K in keyof Point: [K]: p[K] + 10}',
      '[for K in keyof Point: `${K}=${bumped[K]}`].join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('x=11,y=12');
  });

  it('resolves S[K] per field a constraint names, and once for the others', async () => {
    const declarations = [
      ...nodes,
      'struct Tag { text: String }',
      'fn Tag.make(seed: Int) -> Tag: Tag{text: `tag${seed}`}',
      'fn kinds<S is struct { id: Tag, [_] is Node }>(seed: Int) -> S:',
      '  struct{for K in keyof S: [K]: S[K].make(seed)}',
      'struct Tagged { id: Tag, leaf: Leaf }',
    ];
    const lines = ['const made: Tagged = kinds(3)', '`${made.id.text},${made.leaf.value}`'];
    expect(await runText(lines, declarations)).toBe('tag3,3');
  });

  it('runs a generic body once per field of what it is instantiated with, in name order', async () => {
    const declarations = [
      ...nodes,
      'fn names<S is struct { [_] is Node }>() -> String: [for K in keyof S: K].join(",")',
    ];
    expect(await runText(['`${names<Model>()};${names<Inner>()}`'], declarations)).toBe(
      'a,inner;x,y',
    );
  });

  it('is a loop: break, continue, labels and await', async () => {
    const lines = [
      'let seen: Array<String> = []',
      'outer: for K in keyof OrderLike:',
      '  await runtime.commit()',
      '  for J in keyof OrderLike:',
      '    if K == "city": continue outer',
      '    if K == "qty": break outer',
      '    seen.push(`${K}:${J}`)',
      '    break',
      'seen.join(",")',
    ];
    expect(await runText(lines, orderLike)).toBe('country:city');
  });

  it('makes a lambda per pass, capturing that pass key', async () => {
    const lines = [
      'let made: Array<fn() -> String> = []',
      'for K in keyof OrderLike:',
      '  made.push(fn(): K)',
      '[for each in made: each()].join(",")',
    ];
    expect(await runText(lines, orderLike)).toBe('city,country,qty');
  });

  it('makes no struct of a type parameter', () => {
    expect(
      codesOf(
        ...nodes,
        'fn blank<S is struct { [_] is Node }>() -> S:',
        '  S{for K in keyof S: [K]: 0}',
      ),
    ).toEqual([5012]);
  });
});

describe('a loop over a type, nested and degenerate', () => {
  it("resolves what a pass writes with that pass's key: a nested loop over a field's type", async () => {
    const declarations = [
      'struct First { x: Int }',
      'struct Second { z: Int, y: String }',
      'struct Outer { b: Second, a: First }',
    ];
    const lines = [
      'let names: Array<String> = []',
      'for K in keyof Outer:',
      '  for J in keyof Outer[K]:',
      '    names.push(`${K}.${J}`)',
      'names.join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('a.x,b.y,b.z');
  });

  it('runs over a struct with no field as code that never runs, reporting nothing', () => {
    expect(
      codesOf(
        ...nodes,
        'struct Empty {}',
        'fn f(seed: Int):',
        '  for K in keyof Empty:',
        '    const key: String = K',
        '    _ = (key, Empty[K].make(seed))',
      ),
    ).toEqual([]);
  });

  it('reads S[K] before `.` as a type, holding no value of it', () => {
    expect(
      codesOf(
        'extern live struct Socket',
        'fn Socket.defaultPort() -> Int: 80',
        'struct P { s: Socket }',
        'fn f() -> Int:',
        '  let port = 0',
        '  for K in keyof P:',
        '    port = P[K].defaultPort()',
        '  port',
      ),
    ).toEqual([]);
  });

  it('reports a static member through a key naming no field, called or not, once, at the key', () => {
    expect(codesOf(...nodes, ...orderLike, 'fn f(): _ = OrderLike[Int].make(1)')).toEqual([5161]);
    expect(codesOf(...nodes, ...orderLike, 'fn f(): _ = OrderLike[Int].make')).toEqual([5161]);
  });

  it('reads a static member uncalled through a pass over no field as it calls one', () => {
    expect(
      codesOf(
        ...nodes,
        'struct Empty {}',
        'fn f():',
        '  for K in keyof Empty:',
        '    _ = Empty[K].make',
      ),
    ).toEqual([]);
  });

  it('checks type constraints and reductions on written types in every pass, not only the first', () => {
    expect(
      codesOf(
        ...nodes,
        'struct Wrap<N is Node> { n: N }',
        'struct Mixed { a: Leaf, b: Int }',
        'fn f():',
        '  for K in keyof Mixed:',
        '    const w: Wrap<Mixed[K]>? = none',
        '    _ = w',
      ),
    ).toEqual([5101]);
    expect(
      codesOf(
        'struct OnlyA<A in "a"> {}',
        'struct Pair { a: Int, b: Int }',
        'fn f():',
        '  for K in keyof Pair:',
        '    const x: OnlyA<K>? = none',
        '    _ = x',
      ),
    ).toEqual([5131]);
  });

  it('resolves nested function return types and mapped types in each pass', async () => {
    const declarations = [
      'struct Inner { x: Int }',
      'struct Outer { b: Inner, a: Inner }',
      'struct Pair { b: String, a: Int }',
    ];
    const lines = [
      'const p = Pair{b: "hi", a: 3}',
      'let out: Array<String> = []',
      'for K in keyof Pair:',
      '  fn keep(x: Pair[K]) -> Pair[K]: x',
      '  const id = fn(x: Pair[K]) -> Pair[K]: keep(x)',
      '  out.push(`${id(p[K])}`)',
      'for K in keyof Outer:',
      '  const m: { [F in keyof Outer[K]]: Int } = struct{x: 1}',
      '  out.push(`${m.x}`)',
      'out.join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('3,hi,1,1');
  });

  it("parses one key before 'keyof' and 'keyof' alone, and a value's header as before", () => {
    const loop = (header: string) => [...orderLike, 'fn f():', `  for ${header}: _ = 1`];
    expect(codesOf(...loop('K, V in keyof OrderLike'))).toEqual([2054]);
    expect(codesOf(...loop('K in keyof OrderLike | "x"'))).toEqual([2055]);
    expect(codesOf('fn f(s: { a: Int }) -> { a: Int }: struct{for k, v in s: [k]: v}')).toEqual([
      2001,
    ]);
  });
});

describe('the commute law of a loop over a type', () => {
  it('agrees: generic and instantiated, over the concrete struct, and written out by hand', async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, async (fields) => {
        const declared = fields.map((field) => `${field.name}: ${field.type}`).join(', ');
        const value = `Generated{${fields.map((field) => `${field.name}: ${field.value}`).join(', ')}}`;
        const byHand = fields
          .map((field) => field.name)
          .toSorted()
          .map((name) => `\`${name}=\${s.${name}}\``);
        const declarations = [
          `struct Generated { ${declared} }`,
          'fn generic<S is struct { [_] is Stringable }>(s: S) -> String:',
          '  [for K in keyof S: `${K}=${s[K]}`].join(";")',
          'fn concrete(s: Generated) -> String:',
          '  [for K in keyof Generated: `${K}=${s[K]}`].join(";")',
          `fn written(s: Generated) -> String: [${byHand.join(', ')}].join(";")`,
        ];
        const lines = [`const s = ${value}`, '`${generic(s)}|${concrete(s)}|${written(s)}`'];
        const [generic, concrete, written] = String(await runText(lines, declarations)).split('|');
        expect(generic).toBe(written);
        expect(concrete).toBe(written);
      }),
      { numRuns: 25 },
    );
  });
});

describe('a loop over a type in an editor', () => {
  it("hovers its key and S[K] as every pass's, joined", () => {
    const loop = (cursor: string) => [
      'struct P { b: String, a: Int }',
      'fn f():',
      '  for K in keyof P:',
      `    const x: ${cursor} = P{b: "", a: 0}[K]`,
      '    _ = x',
    ];
    expect(hoverCodeAt(...loop('P[‸K]'))).toEqual(['(type) "a" | "b"']);
    expect(hoverCodeAt(...loop('P‸[K]'))).toEqual(['Int | String']);
    const narrowed = [
      'struct P { b: String, a: Int }',
      'fn f():',
      '  for K in keyof P:',
      '    if K == "a": _ = ‸K',
    ];
    expect(hoverCodeAt(...narrowed)).toEqual(['(type) "a"']);
    const staticCall = [
      'struct Leaf { value: Int }',
      'fn Leaf.count() -> Int: 1',
      'struct Tag { text: String }',
      'fn Tag.count() -> Int: 2',
      'struct P { a: Leaf, b: Tag }',
      'fn f() -> { a: Int, b: Int }:',
      '  struct{for K in keyof P: [K]: P[K].count()}',
    ];
    expect(
      hoverCodeAt(...staticCall.slice(0, -1), '  struct{for K in keyof P: [‸K]: P[K].count()}'),
    ).toEqual(['(type) "a" | "b"']);
    expect(
      hoverCodeAt(...staticCall.slice(0, -1), '  struct{for K in keyof P: [K]: P[‸K].count()}'),
    ).toEqual(['(type) "a" | "b"']);
    expect(
      hoverCodeAt(...staticCall.slice(0, -1), '  struct{for K in keyof P: [K]: P‸[K].count()}'),
    ).toEqual(['Leaf | Tag']);
    const constrained = [
      'trait Shown { fn shown(self: Self) -> String }',
      'fn f<S is struct { id: Int, [_] is Shown }>(s: S):',
      '  for ‸K in keyof S:',
      '    const x: S[K] = s[K]',
      '    _ = x',
    ];
    expect(hoverCodeAt(...constrained)).toEqual(['(type) "id" | K']);
    expect(
      hoverCodeAt(
        'trait Shown { fn shown(self: Self) -> String }',
        'fn f<S is struct { id: Int, [_] is Shown }>(s: S):',
        '  for K in keyof S:',
        '    const x: S‸[K] = s[K]',
        '    _ = x',
      ),
    ).toEqual(['Int | S[K]']);
    const associated = [
      'struct Count { n: Int }',
      'fn Count.zero() -> Count: Count{n: 0}',
      'struct Label { t: String }',
      'fn Label.zero() -> Label: Label{t: ""}',
      'struct A:',
      '  type Data = Count',
      'struct B:',
      '  type Data = Label',
      'struct P { a: A, b: B }',
      'fn f() -> { a: Count, b: Label }:',
      '  struct{for K in keyof P: [K]: P[K].‸Data.zero()}',
    ];
    expect(hoverCodeAt(...associated)).toEqual(['A.Data | B.Data']);
  });
});

describe('a member parameter over literal types', () => {
  it('reads as its value, including keyof S on a generic type or function', async () => {
    const declarations = [
      'type Status = "active" | "closed"',
      'fn describe<S in Status>() -> String: S',
      'fn code<N in 200 | 404>() -> Int: N',
      'struct Point { x: Int, y: Int }',
      'struct Entry<S is struct, K in keyof S> { value: S[K] }',
      'fn key<S is struct, K in keyof S>(self: Entry<S, K>) -> K: K',
    ];
    const body = [
      'const e = Entry<Point, "x">{value: 42}',
      '`${describe<"active">()},${describe<"closed">()},${code<200>()},${e.key()}=${e.value}`',
    ];
    expect(await runText(body, declarations)).toBe('active,closed,200,x=42');
  });

  it('over String is no value', () => {
    expect(codesOf('fn describe<S in String>() -> String: S')).toEqual([5011]);
  });
});
