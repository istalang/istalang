/**
 * Checking and running indented values (proposal 5 §1, notes 3 and 11): every row of the
 * meaning-by-type table (structs, shapes, aliases, shared structs with 'new T:', variants refused,
 * maps with bare and quoted keys and custom IndexAssignable+Default types, arrays with '- item' and
 * '- key: value' blocks, unions, and untyped blocks), compile-time constants, every listed error,
 * and the fast-check commutation property against brace and bracket literals.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  reportedNothing,
  reportedOnce,
} from '../../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../../stdlib/prelude/prelude.test-kit.ts';
import { stdProgramOf } from '../../../../binder/bind.test-kit.ts';
import { lines } from '../../../../parser/parse.test-kit.ts';
import { idOf } from '../../../../program/program.test-kit.ts';
import { programModule } from '../../../../program/program.ts';
import { nodesUnder } from '../../../../syntax/tree/index.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import { reported } from '../../../check.test-kit.ts';
import { checkProgram } from '../../../check.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { sameType } from '../../../types/identity/identity.ts';
import type { Type } from '../../../types/type/index.ts';
import { typeText } from '../../../types/type/type-text.ts';

function constantTypeOf(source: string, name = 'target'): Type | undefined {
  const program = stdProgramOf({ 'main.ista': source });
  const checker = checkProgram(program);
  const module = idOf('main.ista');
  const { tree } = programModule(program, module);
  const identifier = nodesUnder(tree, tree.root).find(
    (each): each is Identifier => each.kind === 'Identifier' && each.text === name,
  );
  return identifier === undefined ? undefined : checker.constantNamed(module, identifier)?.type;
}

function constantTypeText(source: string, name = 'target'): string {
  const type = constantTypeOf(source, name);
  return type === undefined ? 'missing' : typeText(type);
}

describe('meaning by type: structs, variants, shapes, aliases and shared structs (§1)', () => {
  const serviceDecls = lines(
    'struct Retry { times: Int = 3, backoffMs: Int = 200 }',
    'struct Service:',
    '  name: String',
    '  replicas: Int = 1',
    '  ports: Array<Int>',
    '  env: Map<String, String>',
    '  retry: Retry',
  );

  it('builds a nominal struct with defaults, nested blocks, maps and arrays', () => {
    const body = lines(
      'const api = Service:',
      '  name: "api"',
      '  ports:',
      '    - 80',
      '    - 443',
      '  env:',
      '    LOG_LEVEL: "debug"',
      '    "x-region": "eu"',
      '  retry:',
      '    backoffMs: 500',
      '(api.name, api.replicas, api.ports, api.env["LOG_LEVEL"], api.env["x-region"], api.retry.times, api.retry.backoffMs)',
    );
    expect(
      mainGives('(String, Int, Array<Int>, String, String, Int, Int)', body, serviceDecls),
    ).toEqual(['api', 1, [80, 443], 'debug', 'eu', 3, 500]);
  });

  it('builds shapes, aliases of shapes, and shared structs via new T:', () => {
    const decls = lines(
      'type Point = { x: Int, y: Int }',
      'shared struct Counter { count: Int, tag: String = "c" }',
    );
    const body = lines(
      'const p1 = Point:',
      '  y: 20, x: 10',
      'const p2: { x: Int, y: Int } =',
      '  x: 5, y: 6',
      'const c = new Counter:',
      '  count: 42',
      'c->count += p1.x + p2.y',
      '`${c->count}:${c->tag}`',
    );
    expect(mainGives('String', body, decls)).toBe('58:c');
  });

  it('refuses a variant named before a block, bare or qualified, naming its call (§3.11)', () => {
    const text = lines(
      'enum Decision { Approved(by: String), Rejected(by: String, reason: String) }',
      'fn f() -> (Decision, Decision):',
      '  const d1: Decision = Approved:',
      '    by: "alice"',
      '  const d2 = Decision.Rejected:',
      '    by: "bob"',
      '    reason: "budget"',
      '  (d1, d2)',
    );
    expect(reported(text).codes).toEqual([
      checkerDiagnostics.variantInBraces.code,
      checkerDiagnostics.variantInBraces.code,
    ]);
  });

  it('refuses a variant named before a block whatever its entries, items or quoted keys', () => {
    for (const entry of ['- 42', '"value": 42']) {
      const text = lines('fn f() -> Result<Int>:', '  return Ok:', `    ${entry}`);
      expect(reported(text).codes).toEqual([checkerDiagnostics.variantInBraces.code]);
    }
  });

  it('supports shorthand names, a leading spread, and a trailing struct comprehension', () => {
    const decls = 'struct Scores { a: Int, b: Int, c: Int }';
    const body = lines(
      'const a = 10',
      'const base = Scores:',
      '  a',
      '  b: 20, c: 30',
      'const updated = Scores:',
      '  ...base',
      '  b: 25',
      'const rest = struct{b: 2, c: 3}',
      'const comp = Scores:',
      '  a: 1',
      '  for k, v in ...rest: [k]: v * 10',
      '(updated.a, updated.b, updated.c, comp.a, comp.b, comp.c)',
    );
    expect(mainGives('(Int, Int, Int, Int, Int, Int)', body, decls)).toEqual([
      10, 25, 30, 1, 20, 30,
    ]);
  });

  it('evaluates fields in written order while storing them in canonical field order', () => {
    const body = lines(
      'let log: Array<String> = []',
      'fn step(label: String, value: Int) -> Int: { log.push(label); value }',
      'const s =',
      '  second: step("second", 2)',
      '  first: step("first", 1)',
      '(log, s.first, s.second)',
    );
    expect(mainGives('(Array<String>, Int, Int)', body)).toEqual([['second', 'first'], 1, 2]);
  });
});

describe('meaning by type: maps, arrays, unions, untyped blocks and constants (§1)', () => {
  it('builds a Map with bare keys (including screaming snake case), quoted reserved words, shorthands, spreads and duplicate keys where the later wins', () => {
    const body = lines(
      'const host = "localhost"',
      'const base: Map<String, String> =',
      '  LOG_LEVEL: "info", "for": "loop"',
      'const env = Map<String, String>:',
      '  ...base',
      '  host',
      '  LOG_LEVEL: "debug"',
      '  "host": "prod.internal"',
      '  dup: "first", "dup": "second"',
      '(env["LOG_LEVEL"], env["for"], env["host"], env["dup"], env.size())',
    );
    expect(mainGives('(String, String, String, String, Int)', body)).toEqual([
      'debug',
      'loop',
      'prod.internal',
      'second',
      4,
    ]);
  });

  it('builds a Map whose key type is a String literal union, and a struct that also has a default(), which the table builds as a struct', () => {
    const decls = lines(
      'type EnvKey = "region" | "tier"',
      'struct Dict { entries: Map<String, Int> }',
      'fn Dict.default() -> Dict: Dict{entries: [:]}',
      'fn setIndex(self: &Dict, key: String, value: Int): self.entries[key] = value',
    );
    const body = lines(
      'const m: Map<EnvKey, Int> =',
      '  region: 1, "tier": 2',
      'const same: Map<EnvKey, Int> = ["region": 1, "tier": 2]',
      'const d: Dict =',
      '  entries:',
      '    alpha: 10, "beta": 20',
      '(m == same, m.size(), d.entries["alpha"] + d.entries["beta"])',
    );
    expect(mainGives('(Bool, Int, Int)', body, decls)).toEqual([true, 2, 30]);
  });

  it('builds arrays from "- value", "- -1", "- ...xs", nested "-" blocks and "- key: value" aligned items', () => {
    const body = lines(
      'const extra = [10, 20]',
      'const nums: Array<Int> =',
      '  - 1',
      '  - -1',
      '  - ...extra',
      'const grid: Array<Array<Int>> =',
      '  -',
      '    - 1',
      '    - 2',
      '  - [3, 4]',
      'const rows: Array<{ name: String, port: Int, meta: { ok: Bool } }> =',
      '  - name: "api"',
      '    port: 80',
      '    meta:',
      '      ok: true',
      '  - name: "worker"',
      '    port: 90',
      '    meta:',
      '      ok: false',
      '(nums, grid[0][1] + grid[1][0], rows[0].name, rows[1].port, rows[0].meta.ok)',
    );
    expect(mainGives('(Array<Int>, Int, String, Int, Bool)', body)).toEqual([
      [1, -1, 10, 20],
      5,
      'api',
      90,
      true,
    ]);
  });

  it('builds the one member of an expected union that the indented value fits', () => {
    const decls = lines(
      'struct Settings { retries: Int, region: String }',
      'struct Entry<S is struct, K in keyof S> { key: K, value: S[K] }',
      'type AnyEntry = Entry<Settings, "retries"> | Entry<Settings, "region">',
    );
    const body = lines(
      'const e: AnyEntry = Entry:',
      '  key: "region", value: "eu"',
      'const u1: Settings | Array<Int> =',
      '  retries: 3, region: "us"',
      'const u2: Settings | Array<Int> =',
      '  - 7',
      '  - 8',
      'const opt: Settings? =',
      '  retries: 1, region: "ap"',
      'const matched = match e:',
      '  case Entry<Settings, "region">{value}: value',
      '  case Entry<Settings, "retries">{value}: `${value}`',
      '(matched, opt?.region ?? "none", u2 is Array<Int>)',
    );
    expect(mainGives('(String, String, Bool)', body, decls)).toEqual(['eu', 'ap', true]);
  });

  it('types an untyped indented value as a shape when all keys are bare, a Map<String, V> when any key is quoted, and an Array<T> when items', () => {
    expect(constantTypeText(lines('const target =', '  x: 1, y: "two"'))).toBe(
      'struct { x: Int, y: String }',
    );
    expect(constantTypeText(lines('const target =', '  x: 1, "y": 2'))).toBe('Map<String, Int>');
    expect(constantTypeText(lines('const target =', '  - 1', '  - 2'))).toBe('Array<Int>');
  });

  it('computes top-level constants built with indented values at compile time', () => {
    const decls = lines(
      'struct Pair { a: Int, b: Int = 5 }',
      'const first = Pair:',
      '  a: 2',
      'const table =',
      '  "k": first',
      'const items: Array<Pair> =',
      '  - first',
      '  - a: 10',
    );
    expect(mainGives('Int', 'items[0].a + items[0].b + items[1].a + table["k"].b', decls)).toBe(22);
  });
});

describe('indented value errors (§1)', () => {
  it.each([
    ['items where a struct is built', lines('struct S { a: Int }', 'const s = S:', '  - 1')],
    ['items where a shape is expected', lines('const s: { a: Int } =', '  - 1')],
    ['items where a map is built', lines('const m: Map<String, Int> =', '  - 1')],
    ['keys where an array is built', lines('const xs: Array<Int> =', '  a: 1')],
    ['items and keys mixed in one indented value', lines('const x =', '  a: 1', '  - 2')],
    [
      'a quoted key where a nominal struct is built',
      lines('struct S { name: String }', 'const s = S:', '  "name": "api"'),
    ],
    [
      'a quoted key where a shape is expected',
      lines('const s: { name: String } =', '  "name": "api"'),
    ],
    [
      'a bare key where the map key type no String literal fits',
      lines('const m: Map<Int, String> =', '  a: "x"'),
    ],
    [
      'a quoted key where the map key type no String literal fits',
      lines('const m: Map<Int, String> =', '  "1": "x"'),
    ],
    [
      'a bare key that does not fit a String literal union key type',
      lines('const m: Map<"a" | "b", Int> =', '  c: 1'),
    ],
    [
      'a single-field struct built positionally in an indented value',
      lines('struct Wrap { value: Int }', 'const w = Wrap:', '  42'),
    ],
  ])('reports %s', (_name, code) => {
    expect(reported(code).codes.length).toBeGreaterThan(0);
  });

  it('reports unknown, missing and repeated fields, and shared struct new mismatches', () => {
    const decls = 'struct P { x: Int, y: Int }\nshared struct C { n: Int }\n';
    expect(reported(`${decls}const p = P:\n  x: 1, z: 2`).codes).toContain(
      checkerDiagnostics.unknownField.code,
    );
    expect(reported(`${decls}const p = P:\n  x: 1`).codes).toContain(
      checkerDiagnostics.missingField.code,
    );
    expect(reported(`${decls}const p = P:\n  x: 1, x: 2`).codes).toContain(
      checkerDiagnostics.repeatedField.code,
    );
    expect(reported(`${decls}fn f() -> C:\n  return C:\n    n: 1`)).toEqual(
      reportedOnce(checkerDiagnostics.sharedNeedsNew.code, 'C'),
    );
    expect(reported(`${decls}fn f() -> P:\n  return new P:\n    x: 1, y: 2`)).toEqual(
      reportedOnce(checkerDiagnostics.newNotShared.code, 'P'),
    );
  });
});

describe('commutation property: indented values vs brace and bracket literals (§1, note 11)', () => {
  interface GeneratedValue {
    readonly type: string;
    readonly braced: string;
    readonly indented: (depth: number) => string;
  }

  const leafValues: fc.Arbitrary<GeneratedValue> = fc.oneof(
    fc
      .integer({ min: -50, max: 50 })
      .map((n) => ({ type: 'Int', braced: String(n), indented: () => String(n) })),
    fc
      .constantFrom('"alpha"', '"beta"', '""')
      .map((s) => ({ type: 'String', braced: s, indented: () => s })),
    fc.boolean().map((b) => ({ type: 'Bool', braced: String(b), indented: () => String(b) })),
  );

  const nestedValues: fc.Arbitrary<GeneratedValue> = fc.letrec<{ val: GeneratedValue }>((tie) => ({
    val: fc.oneof(
      { depthSize: 'small' },
      leafValues,
      fc.tuple(tie('val'), tie('val')).map(
        ([first, second]): GeneratedValue => ({
          type: `{ a: ${first.type}, b: ${second.type} }`,
          braced: `struct{a: ${first.braced}, b: ${second.braced}}`,
          indented: (depth: number) => {
            const pad = ' '.repeat(depth);
            return `\n${pad}a: ${first.indented(depth + 2)}\n${pad}b: ${second.indented(depth + 2)}`;
          },
        }),
      ),
      fc.array(leafValues, { minLength: 1, maxLength: 3 }).map((items): GeneratedValue => {
        const elemType = items[0]?.type ?? 'Int';
        const sameTyped = items.filter((item) => item.type === elemType);
        return {
          type: `Array<${elemType}>`,
          braced: `[${sameTyped.map((item) => item.braced).join(', ')}]`,
          indented: (depth: number) => {
            const pad = ' '.repeat(depth);
            return `\n${sameTyped.map((item) => `${pad}- ${item.indented(depth + 2)}`).join('\n')}`;
          },
        };
      }),
      fc.tuple(leafValues, leafValues).map(([first, second]): GeneratedValue => {
        const valType = first.type;
        const sec = second.type === valType ? second : first;
        return {
          type: `Map<String, ${valType}>`,
          braced: `["k1": ${first.braced}, "x-k2": ${sec.braced}]`,
          indented: (depth: number) => {
            const pad = ' '.repeat(depth);
            return `\n${pad}k1: ${first.indented(depth + 2)}\n${pad}"x-k2": ${sec.indented(depth + 2)}`;
          },
        };
      }),
    ),
  })).val;

  it('checks to the same type and runs to the same value whether written indented or with braces/brackets', () => {
    fc.assert(
      fc.property(nestedValues, (generated) => {
        const source = lines(
          `const firstVal: ${generated.type} = ${generated.braced}`,
          `const secondVal: ${generated.type} = ${generated.indented(2)}`,
        );
        expect(reported(source)).toEqual(reportedNothing);
        const typeA = constantTypeOf(source, 'firstVal');
        const typeB = constantTypeOf(source, 'secondVal');
        expect(typeA !== undefined && typeB !== undefined && sameType(typeA, typeB)).toBe(true);
        expect(mainGives('Bool', 'firstVal == secondVal', source)).toBe(true);
      }),
      { numRuns: 35 },
    );
  });
});
