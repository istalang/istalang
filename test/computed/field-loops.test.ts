/**
 * Field loops (docs/proposals/4-computed-types.md §5, spec §4): `for key, value in ...x:` runs its
 * body once per field of `x`, in name order, as the body written out once per field. Each pass is
 * checked on its own (each field's overloads), constrained type parameters are checked once per
 * named entry and once for the others, the loop is a loop for `break`, `continue`, labels and
 * `await`, and its key is a single key. A property holds the commute law: a generic loop
 * instantiated, the loop over the concrete struct, and the body written out by hand agree.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hoverCodeAt } from '../unions/unions.test-kit.ts';
import { codesOf, generatedFieldsArbitrary, runMain } from './computed.test-kit.ts';

const formDeclarations = [
  'trait FormNode:',
  '  type Data',
  '  fn validate(self: Self, data: Self.Data) -> Array<String>',
  'struct Field<T>:',
  '  value: T?',
  '  type Data = T',
  'fn validate<T>(self: Field<T>, data: T) -> Array<String>:',
  '  if self.value == none: ["missing"] else: []',
  'struct Group<S is struct { [_] is FormNode }>:',
  '  fields: S',
  '  type Data = { [F in keyof S]: S[F].Data }',
  'fn validate<S is struct { [_] is FormNode }>(self: Group<S>, data: Group<S>.Data) -> Array<String>:',
  '  let errors: Array<String> = []',
  '  for field, node in ...self.fields:',
  '    errors = [...errors, ...node.validate(data[field]).map(fn e: `${field}: ${e}`)]',
  '  errors',
];

/** Runs `lines` as `main`'s body, giving a String. */
async function runText(
  lines: readonly string[],
  declarations: readonly string[],
): Promise<unknown> {
  return await runMain('String', lines.join('\n  '), declarations);
}

describe('a field loop', () => {
  it("visits every struct's fields in name order, a declaration's and a shape's", async () => {
    const visit = (value: string) => [
      'let order: Array<String> = []',
      `for k, v in ...${value}:`,
      '  order.push(`${k}=${v}`)',
      'order.join(",")',
    ];
    const declarations = ['struct Misordered { z: Int, a: Int, m: Int }'];
    expect(await runText(visit('Misordered{z: 1, a: 2, m: 3}'), declarations)).toBe('a=2,m=3,z=1');
    expect(await runText(visit('struct{z: 1, a: 2, m: 3}'), declarations)).toBe('a=2,m=3,z=1');
  });

  it("checks its body once per field, each pass choosing that field's overload", async () => {
    const declarations = [
      'struct Mixed { s: String, n: Int }',
      'fn show(x: Int) -> String: `int ${x}`',
      'fn show(x: String) -> String: `str ${x}`',
    ];
    const lines = [
      'let out = ""',
      'for k, v in ...Mixed{s: "a", n: 1}:',
      '  out = `${out}${k}:${show(v)};`',
      'out',
    ];
    expect(await runText(lines, declarations)).toBe('n:int 1;s:str a;');
  });

  it('runs over a constrained type parameter: its named entries, then the others', async () => {
    const declarations = [
      ...formDeclarations,
      'fn names<S is struct { title: String, [_] is FormNode }>(form: S) -> Array<String>:',
      '  let out: Array<String> = []',
      '  for k, _ in ...form:',
      '    out.push(k)',
      '  out',
    ];
    const lines = [
      'const form = struct{title: "t", z: Field<Int>{value: 1}, a: Field<String>{value: "x"}}',
      'const group = Group{fields: struct{qty: Field<Int>{value: 3}, country: Field<String>{value: none}}}',
      '`${names(form).join(",")}|${group.validate(struct{country: "x", qty: 1}).join(",")}`',
    ];
    expect(await runText(lines, declarations)).toBe('a,title,z|country: missing');
  });

  it('matches its key by literal patterns in every pass, the others pass too', async () => {
    const declarations = [
      ...formDeclarations,
      'fn tags<S is struct { title: String, [_] is FormNode }>(form: S) -> Array<String>:',
      '  let out: Array<String> = []',
      '  for k, _ in ...form:',
      '    match k:',
      '      case "title": out.push("T")',
      '      case "region": out.push("R")',
      '      case _: out.push(k)',
      '    if k == "a": out.push("=a")',
      '  out',
    ];
    const lines = [
      'const form = struct{title: "t", region: Field<String>{value: "eu"}, a: Field<Int>{value: 1}}',
      'tags(form).join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('a,=a,R,T');
  });

  it('runs over no field of an empty struct, and over the value behind a shared struct', async () => {
    const declarations = ['struct Empty', 'shared struct SharedPair { b: Int, a: Int }'];
    const lines = [
      'let count: Int = 0',
      'for _, _ in ...Empty:',
      '  count += 1',
      'const pair = new SharedPair{b: 2, a: 1}',
      'let shared: Array<String> = []',
      'for k, v in ...*pair:',
      '  shared.push(`${k}=${v}`)',
      '`${count}|${shared.join(",")}`',
    ];
    expect(await runText(lines, declarations)).toBe('0|a=1,b=2');
  });

  it('is a loop: break, continue, labels, await and a destructured value', async () => {
    const declarations = [
      "import * as runtime from 'runtime'",
      'struct Pairs { c: (Int, String), b: (Int, String), a: (Int, String) }',
    ];
    const lines = [
      'const pairs = Pairs{c: (3, "three"), b: (2, "two"), a: (1, "one")}',
      'let seen: Array<String> = []',
      'outer: for k, (number, name) in ...pairs:',
      '  await runtime.commit()',
      '  for _, _ in ...pairs:',
      '    if k == "a": continue outer',
      '    if k == "c": break outer',
      '    seen.push(`${k}:${number}:${name}`)',
      '    break',
      'seen.join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('b:2:two');
  });

  it('makes a lambda per pass, capturing that pass key and value', async () => {
    const declarations = ['struct Pair { b: String, a: Int }'];
    const lines = [
      'let made: Array<fn() -> String> = []',
      'for k, v in ...Pair{b: "x", a: 1}:',
      '  made.push(fn(): `${k}=${v}`)',
      '[for each in made: each()].join(",")',
    ];
    expect(await runText(lines, declarations)).toBe('a=1,b=x');
  });

  it("has a single key: y[key] reads and writes the field it names in y's type", async () => {
    const declarations = [
      'struct Counts { b: Int, a: Int }',
      'fn doubled<S is struct { [_]: Int }>(s: S) -> S:',
      '  let out = s',
      '  for k, v in ...s:',
      '    out[k] = v * 2',
      '  out',
    ];
    const lines = [
      'let counts = Counts{b: 2, a: 1}',
      'for k, _ in ...counts:',
      '  counts[k] += 10',
      'const twice = doubled(counts)',
      '`${counts.a},${counts.b}|${twice.a},${twice.b}`',
    ];
    expect(await runText(lines, declarations)).toBe('11,12|22,24');
  });

  it('is refused over what has no fields, with targets other than a key and a value', () => {
    expect(codesOf('fn f(xs: Array<Int>):', '  for k, v in ...xs:', '    ()')).toEqual([5166]);
    expect(codesOf('struct P { a: Int }', 'fn f(p: P):', '  for v in ...p:', '    ()')).toEqual([
      2030,
    ]);
    expect(
      codesOf('struct P { a: Int }', 'fn f(p: P):', '  for (k,), v in ...p:', '    ()'),
    ).toEqual([2031]);
  });

  it('reports an `if` in its header once, in a loop and in each comprehension alike', () => {
    const struct = 'struct P { a: Int, b: Int }';
    expect(codesOf(struct, 'fn f(p: P):', '  for k, v in ...p if v > 1:', '    ()')).toEqual([
      2037,
    ]);
    expect(
      codesOf(struct, 'fn f(p: P) -> Int:', '  [for k, v in ...p if v > 1: v].length()'),
    ).toEqual([2037]);
    expect(codesOf(struct, 'fn f(p: P) -> P:', '  P{for k, v in ...p if v > 1: [k]: v}')).toEqual([
      2037,
    ]);
  });

  it('reports a mistake every pass makes alike once', () => {
    const lines = [
      'struct P { b: Int, a: String }',
      'fn needs<T is Encodable>(t: T): ()',
      'fn f(p: P, made: fn() -> Int):',
      '  for _, _ in ...p:',
      '    const wrong: Int = "text"',
      '    needs(made)',
    ];
    expect(codesOf("import Encodable from 'json'", ...lines)).toEqual([5001, 5101]);
  });

  it("compares and matches its key with any field's name, warning of a case no pass reaches", async () => {
    const declarations = ['struct P { b: Int, a: Int }'];
    const lines = [
      'let out = ""',
      'for k, v in ...P{b: 2, a: 1}:',
      '  const tag = match k:',
      '    case "a": "first"',
      '    case "b": "second"',
      '  out = `${out}${tag}${if k == "b": "!" else: ""};`',
      'out',
    ];
    expect(await runText(lines, declarations)).toBe('first;second!;');
    const unreached = [
      'struct P { b: Int, a: Int }',
      'fn f(p: P) -> Int:',
      '  let total = 0',
      '  for k, _ in ...p:',
      '    total += match k:',
      '      case "a" | "b": 1',
      '      case _: 2',
      '  total',
    ];
    expect(codesOf(...unreached)).toEqual([5401]);
  });
});

describe('a field loop in an editor', () => {
  it("hovers its key and value as every pass's, joined", () => {
    const loop = (cursor: string) => [
      'struct P { b: String, a: Int }',
      'fn f(p: P):',
      '  for k, v in ...p:',
      `    _ = ${cursor}`,
    ];
    expect(hoverCodeAt(...loop('‸k'))).toEqual(['(variable) k: "a" | "b"']);
    expect(hoverCodeAt(...loop('‸v'))).toEqual(['(variable) v: Int | String']);
  });
});

describe('the commute law of a field loop', () => {
  it('agrees: generic and instantiated, over the concrete struct, and written out by hand', async () => {
    await fc.assert(
      fc.asyncProperty(generatedFieldsArbitrary, async (fields) => {
        const declared = fields.map((field) => `${field.name}: ${field.type}`).join(', ');
        const value = `Generated{${fields.map((field) => `${field.name}: ${field.value}`).join(', ')}}`;
        const byHand = fields
          .map((field) => field.name)
          .toSorted()
          .map((name) => `  out = \`\${out}${name}=\${s.${name}};\``);
        const declarations = [
          `struct Generated { ${declared} }`,
          'fn generic<S is struct { [_] is Stringable }>(s: S) -> String:',
          '  let out = ""',
          '  for k, v in ...s:',
          '    out = `${out}${k}=${v};`',
          '  out',
          'fn concrete(s: Generated) -> String:',
          '  let out = ""',
          '  for k, v in ...s:',
          '    out = `${out}${k}=${v};`',
          '  out',
          'fn written(s: Generated) -> String:',
          '  let out = ""',
          ...byHand,
          '  out',
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
