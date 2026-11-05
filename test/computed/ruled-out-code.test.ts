/**
 * Code a pass rules out (spec §4 field loops, §4 `if` and `match`): a loop over a struct with no
 * fields still checks its body once, as code that never runs, its key and value of a type nothing
 * can be wrong about, so a mistake that doesn't depend on a field is still found, and nothing runs.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  codesOf,
  type GeneratedField,
  generatedFieldsArbitrary,
  runMain,
} from './computed.test-kit.ts';

describe('a loop over a struct with no fields', () => {
  it('checks its body once, so a mistake independent of the field is reported', () => {
    expect(
      codesOf(
        'struct Empty',
        'fn f(e: Empty) -> Int:',
        '  for k, v in ...e:',
        '    missing(1)',
        '  0',
      ),
    ).toEqual([5103]);
    expect(
      codesOf(
        'struct Empty',
        'fn f(e: Empty) -> Int:',
        '  const total = 0',
        '  for _, v in ...e:',
        '    total = v',
        '  total',
      ),
    ).toEqual([5008]);
    expect(
      codesOf(
        'struct Empty',
        'fn twice(n: Int) -> Int: n * 2',
        'fn f(e: Empty) -> Array<Int>:',
        '  [for k, _ in ...e: twice("k")]',
      ),
    ).toContain(5002);
  });

  it('accepts a body that fits any field, reads members of its value, and runs nothing', () => {
    const declarations = ['struct Empty', 'trait Named:', '  fn name(self: Self) -> String'];
    const lines = [
      'let seen: Array<String> = []',
      'for k, v in ...Empty:',
      '  seen.push(`${k}:${v.name()}:${v.label}`)',
      'const keys = [for k, v in ...Empty: `${k}${v.size()}`]',
      'const copy: {} = struct{for k, v in ...Empty: [k]: v.inner}',
      '`${seen.length()}|${keys.length()}`',
    ];
    expect(codesOf(...declarations, 'fn f() -> ():', `  ${lines.join('\n  ')}`, '  ()')).toEqual(
      [],
    );
    expect(runMain('String', lines.join('\n  '), declarations)).toBe('0|0');
  });
});

describe('a value of type Never', () => {
  const declarations = [
    'struct P { x: Int }',
    'fn stopped(flag: Bool) -> String:',
    '  if flag:',
    '    const n = panic("stop")',
    '    const sum = n.x + n.size() + -n',
    '    const text = `${n}${n[0]}${n.0}${n ?? 1}${n.y?.z}`',
    '    for k, v in ...n:',
    '      _ = `${k}${v.y}`',
    '    const label = match n:',
    '      case "a": "a"',
    '      case P{x}: `${x}`',
    '      case _: "other"',
    '    return `${sum}${text}${label}${n == "b"}${n < 3}${n is Int}`',
    '  "ran"',
  ];

  it('is operated on silently, and the code compiles and runs up to it', () => {
    expect(codesOf(...declarations)).toEqual([]);
    expect(runMain('String', 'stopped(false)', declarations)).toBe('ran');
  });

  it("still reports what doesn't depend on it, and decides no condition", () => {
    expect(
      codesOf(
        'struct Empty',
        'fn f(e: Empty) -> Int:',
        '  let total = 0',
        '  for k, v in ...e:',
        '    if k == "a":',
        '      total += v',
        '    missing(v)',
        '  total',
      ),
    ).toEqual([5103]);
  });
});

const mixed = ['struct Mixed { count: Int; name: String; size: Int }'];

describe('a condition decided by types', () => {
  it("rules out a field loop pass's branch, so each field's code is checked where it runs", () => {
    const lines = [
      'const m = Mixed{count: 2, name: "x", size: 5}',
      'let total = 0',
      'let names: Array<String> = []',
      'for k, v in ...m:',
      '  if k == "count" or k == "size":',
      '    total += v',
      '  elif k == "name":',
      '    names = [...names, v]',
      'let seen = ""',
      'for k, v in ...m:',
      '  match k:',
      '    case "name": seen = `${seen}${v.length()}`',
      '    case _: seen = `${seen}+`',
      '`${total}|${names.join(",")}|${seen}`',
    ];
    expect(codesOf(...mixed, 'fn f() -> String:', `  ${lines.join('\n  ')}`)).toEqual([]);
    expect(runMain('String', lines.join('\n  '), mixed)).toBe('7|x|+1+');
  });

  it('is warned of where it rules out code everywhere, and outside a loop too', () => {
    expect(
      codesOf(
        ...mixed,
        'fn f(m: Mixed) -> Int:',
        '  let total = 0',
        '  for k, v in ...m:',
        '    if k == "missing":',
        '      total += v',
        '  const k: "x" = "x"',
        '  if k == "y":',
        '    total = "ill-typed"',
        '  total',
      ),
    ).toEqual([5009, 5421, 5421]);
  });

  it("is decided false over the others' key for a name the constraint lists", () => {
    const declarations = [
      'fn sizes<S is struct { title: String; [_]: Int }>(s: S) -> Int:',
      '  let total = 0',
      '  for k, v in ...s:',
      '    if k != "title":',
      '      total += v',
      '  total',
      'struct Doc { title: String; pages: Int; notes: Int }',
    ];
    const body = 'sizes(Doc{title: "t", pages: 3, notes: 4})';
    expect(codesOf(...declarations)).toEqual([]);
    expect(runMain('Int', body, declarations)).toBe(7);
  });
});

/** Code that type-checks only for a field of `type`, reading its value `v`. */
function onlyFor(type: GeneratedField['type'], v: string): string {
  switch (type) {
    case 'Int':
      return `\`\${${v} + 1}\``;
    case 'String':
      return `\`\${${v}.length()}\``;
    default:
      return `\`\${not ${v}}\``;
  }
}

describe('the commute law for decided conditions', () => {
  it('agrees: a generic loop instantiated, the loop over the struct, and the body by hand', () => {
    const fieldsAndTarget = generatedFieldsArbitrary.chain((fields) =>
      fc.tuple(fc.constant(fields), fc.constantFrom(...fields.map((f) => f.name))),
    );
    fc.assert(
      fc.property(fieldsAndTarget, ([fields, name]) => {
        const targetType = fields.find((f) => f.name === name)?.type ?? 'Int';
        const code = (v: string) => onlyFor(targetType, v);
        const constraint = fields.map((f) => `${f.name}: ${f.type}`).join('; ');
        const value = `Gen{${fields.map((f) => `${f.name}: ${f.value}`).join(', ')}}`;
        const declarations = [
          `struct Gen { ${constraint} }`,
          `fn generic<S is struct { ${constraint} }>(s: S) -> String:`,
          '  let out = "-"',
          '  for k, v in ...s:',
          `    if k == "${name}": out = ${code('v')}`,
          '  out',
          'fn concrete(s: Gen) -> String:',
          '  let out = "-"',
          '  for k, v in ...s:',
          `    if k == "${name}": out = ${code('v')}`,
          '  out',
          'fn byHand(s: Gen) -> String:',
          '  let out = "-"',
          ...fields
            .map((f) => f.name)
            .sort()
            .map((field) => `  if "${field}" == "${name}": out = ${code(`s.${field}`)}`),
          '  out',
        ];
        const body = `\`\${generic(${value})}|\${concrete(${value})}|\${byHand(${value})}\``;
        const [generic, concrete, byHand] = String(runMain('String', body, declarations)).split(
          '|',
        );
        expect([generic, byHand]).toEqual([concrete, concrete]);
        expect(codesOf(...declarations).filter((each) => each !== 5421 && each !== 5009)).toEqual(
          [],
        );
      }),
      { numRuns: 12 },
    );
  });
});

describe('a member parameter compared with a literal no member is', () => {
  it('compares, always unequal, and a case of it is ruled out', () => {
    const declarations = [
      'fn typo<K in "a" | "b">(k: K) -> String:',
      '  match k:',
      '    case "c": k.missing()',
      '    case _: "other"',
      'fn typoEquals<K in "a" | "b">(k: K) -> Bool:',
      '  k == "c"',
    ];
    expect(codesOf(...declarations)).toEqual([5422]);
    expect(runMain('String', '`${typo("a")}|${typoEquals("b")}`', declarations)).toBe(
      'other|false',
    );
  });
});
