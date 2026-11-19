/**
 * Patterns and comparisons the subject's type rules out (spec §11.3, §11.1): a case whose pattern its
 * subject's type can't hold, a literal outside it, another type, another enum's variant, a type an
 * `any` value never holds, never matches, so it is warned of once (5422) and never runs; an `==`,
 * `!=` or `is` whose operands' types fix it is warned of once (5421) and is that value. A field
 * loop's pass gives its value one field's type, so the body written out for that field must
 * compile: the generic loop, the loop over the struct and the body by hand agree.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkerDiagnostics } from '../../src/compiler/checker/diagnostics/index.ts';
import { codesOf, runMain } from '../written-types.test-kit.ts';
import { type GeneratedField, generatedFieldsArbitrary } from './computed.test-kit.ts';

const { heldNoValue, decidedCondition, unreachableCase } = checkerDiagnostics;

/** What code its types rule out is warned of by: by hand, a key's own literal decides its case. */
const warnings = new Set([heldNoValue.code, decidedCondition.code, unreachableCase.code]);

describe('a field loop over fields of different types', () => {
  it('matches each field by its type and its key, with nothing reported', async () => {
    const declarations = [
      'struct Mixed { a: Int, b: String, c: Bool }',
      'fn describe(m: Mixed) -> String:',
      '  let out = ""',
      '  for k, v in ...m:',
      '    const kind = match v:',
      '      case Int as n: `int ${n}`',
      '      case String as s: `str ${s}`',
      '      case _: "other"',
      '    const first = match k:',
      '      case "a": "A"',
      '      case _: "-"',
      '    out = `${out}${k}:${kind}${first};`',
      '  out',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(await runMain('String', 'describe(Mixed{a: 1, b: "x", c: true})', declarations)).toBe(
      'a:int 1A;b:str x-;c:other-;',
    );
  });
});

describe('a case its subject’s type rules out, written over one type', () => {
  it.each([
    ['another type', 'fn f(x: Int) -> Int:\n  match x:\n    case String: 0\n    case _: 1'],
    [
      'a literal of another base',
      'fn f(x: Int) -> Int:\n  match x:\n    case "c": 0\n    case _: 1',
    ],
    [
      'none where none is held',
      'fn f(x: Int) -> Int:\n  match x:\n    case none: 0\n    case _: 1',
    ],
    [
      'another struct',
      'struct P { x: Int }\nstruct Q { x: Int }\nfn f(p: P) -> Int:\n  match p:\n    case Q{x}: x\n    case _: 1',
    ],
    [
      "another enum's variant",
      'enum E:\n  A\nenum G:\n  B\nfn f(e: E) -> Int:\n  match e:\n    case G.B: 0\n    case _: 1',
    ],
    [
      'a type an any value never holds',
      'trait Named:\n  fn name(self: Self) -> String\nfn f(x: any Named) -> Int:\n  match x:\n    case Int: 0\n    case _: 1',
    ],
    [
      'a field compared with what its type never holds',
      'struct P { x: Int }\nfn f(p: P) -> Int:\n  match p:\n    case P{x == "c"}: 0\n    case _: 1',
    ],
  ])('%s is warned of once, and never runs', (_case, text) => {
    expect(codesOf(text)).toEqual([heldNoValue.code]);
  });

  it('leaves the cases that run as they are', async () => {
    const declarations = [
      'fn f(x: Int) -> Int:',
      '  match x:',
      '    case String: 0',
      '    case n: n + 1',
    ];
    expect(await runMain('Int', 'f(4)', declarations)).toBe(5);
  });
});

describe('a union subject', () => {
  it.each([
    [
      'a literal outside it',
      'fn f(x: "a" | "b") -> Int:\n  match x:\n    case "c": 0\n    case _: 1',
    ],
    [
      'a type outside it',
      'fn f(x: Int | String) -> Int:\n  match x:\n    case Bool: 0\n    case _: 1',
    ],
  ])('rules out %s with one warning, no error', (_case, text) => {
    expect(codesOf(text)).toEqual([heldNoValue.code]);
  });

  it('keeps an alternative that runs, leaving out the one ruled out', async () => {
    const declarations = [
      'fn f(x: "a" | "b") -> String:',
      '  match x:',
      '    case "c" | "a" as y: y',
      '    case "b": "b"',
    ];
    expect(codesOf(...declarations)).toEqual([]);
    expect(await runMain('String', '`${f("a")}${f("b")}`', declarations)).toBe('ab');
  });

  it.each([
    ['==', 'fn f(x: "a" | "b") -> Bool: x == "c"', false],
    ['!=', 'fn f(x: "a" | "b") -> Bool: x != "c"', true],
    ['is', 'fn f(x: "a" | "b") -> Bool: x is "c"', false],
    ['== against a type that never holds it', 'fn f(x: Int | String) -> Bool: x == true', false],
  ])('decides %s by the types, warned of once', async (_case, text, value) => {
    expect(codesOf(text)).toEqual([decidedCondition.code]);
    expect(await runMain('Bool', 'f("a")', [text])).toBe(value);
  });
});

/**
 * A `match` on the key `k` of a field, by `name`, then, unless `keyOnly`, on its value `v` by its
 * type: a type pattern needs the value's type known, which a struct constraint's other fields
 * aren't (§8.1), so a generic loop matches its keys only.
 */
function matchesOf(v: string, k: string, name: string, keyOnly = false): readonly string[] {
  const kinds = [
    `    const kind = match ${v}:`,
    '      case Int as n: `i${n}`',
    '      case String as t: `s${t}`',
    '      case Bool as b: `b${b}`',
  ];
  return [
    ...(keyOnly ? ['    const kind = ""'] : kinds),
    `    const first = match ${k}:`,
    `      case "${name}": "!"`,
    '      case _: "."',
    '    out = `${out}${kind}${first}`',
  ];
}

/** What each of `functions`, `fn name(s: Gen) -> String`, gives on the struct of `fields`. */
async function outcomes(
  fields: readonly GeneratedField[],
  declarations: readonly string[],
  functions: readonly string[],
): Promise<readonly string[]> {
  const value = `Gen{${fields.map((f) => `${f.name}: ${f.value}`).join(', ')}}`;
  const body = `[${functions.map((each) => `${each}(${value})`).join(', ')}]`;
  return (await runMain('Array<String>', body, declarations)) as readonly string[];
}

/** The errors `declarations` report, leaving out what code its types rule out is warned of by. */
function errorsOf(declarations: readonly string[]): readonly number[] {
  return codesOf(...declarations).filter((code) => !warnings.has(code));
}

const fieldsAndTarget = generatedFieldsArbitrary.chain((fields) =>
  fc.tuple(fc.constant(fields), fc.constantFrom(...fields.map((f) => f.name))),
);

describe('the commute law for ruled-out cases', () => {
  it('agrees: the loop over the struct and the body by hand, on types and keys', async () => {
    await fc.assert(
      fc.asyncProperty(fieldsAndTarget, async ([fields, name]) => {
        const declarations = [
          structOf(fields),
          ...loopOver('concrete', 'Gen', { name }),
          ...byHand(fields, name),
        ];
        expect(errorsOf(declarations)).toEqual([]);
        const [concrete, hand] = await outcomes(fields, declarations, ['concrete', 'byHand']);
        expect(hand).toBe(concrete);
      }),
      { numRuns: 12 },
    );
  });

  it('agrees: a generic loop instantiated, the loop over the struct, and by hand, on keys', async () => {
    await fc.assert(
      fc.asyncProperty(fieldsAndTarget, async ([fields, name]) => {
        const constraint = `S is struct { ${fieldList(fields)} }`;
        const declarations = [
          structOf(fields),
          ...loopOver(`generic<${constraint}>`, 'S', { name, keyOnly: true }),
          ...loopOver('concrete', 'Gen', { name, keyOnly: true }),
          ...byHand(fields, name, true),
        ];
        expect(errorsOf(declarations)).toEqual([]);
        const [generic, concrete, hand] = await outcomes(fields, declarations, [
          'generic',
          'concrete',
          'byHand',
        ]);
        expect([generic, hand]).toEqual([concrete, concrete]);
      }),
      { numRuns: 12 },
    );
  });
});

function fieldList(fields: readonly GeneratedField[]): string {
  return fields.map((f) => `${f.name}: ${f.type}`).join(', ');
}

function structOf(fields: readonly GeneratedField[]): string {
  return `struct Gen { ${fieldList(fields)} }`;
}

/** Which field a loop's `match` on its key names, and whether it matches its values too. */
interface Matching {
  readonly name: string;
  readonly keyOnly?: boolean;
}

/** `fn header(s: type) -> String`, a field loop over `s` matching each field. */
function loopOver(header: string, type: string, { name, keyOnly }: Matching): readonly string[] {
  return [
    `fn ${header}(s: ${type}) -> String:`,
    '  let out = ""',
    '  for k, v in ...s:',
    ...matchesOf('v', 'k', name, keyOnly),
    '  out',
  ];
}

/** `fn byHand(s: Gen) -> String`, the loop's body written out once per field, in name order. */
function byHand(fields: readonly GeneratedField[], name: string, keyOnly = false) {
  const passes = fields
    .map((f) => f.name)
    .sort()
    .flatMap((field) => ['  if true:', ...matchesOf(`s.${field}`, `"${field}"`, name, keyOnly)]);
  return ['fn byHand(s: Gen) -> String:', '  let out = ""', ...passes, '  out'];
}
