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
  });
});

describe('a member parameter over literal types', () => {
  it('reads as its value', async () => {
    const declarations = [
      'type Status = "active" | "closed"',
      'fn describe<S in Status>() -> String: S',
    ];
    expect(await runText(['`${describe<"active">()},${describe<"closed">()}`'], declarations)).toBe(
      'active,closed',
    );
  });

  it('over String is no value', () => {
    expect(codesOf('fn describe<S in String>() -> String: S')).toEqual([5011]);
  });
});
