/**
 * The formatter over every corpus file and spec example (formatter.md, Acceptance 1–4, 6), and the
 * style decisions those inputs don't pin down, each on a small module.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { printType, typeTree } from '../compiler/parser/grammar/type-precedence.test-kit.ts';
import {
  formattableInputs,
  lines,
  parseText,
  roundTripOf,
  unexplainedLongLines,
} from './format.test-kit.ts';
import { formatText, formatTree } from './format.ts';

describe('formatting every corpus file and spec example', () => {
  it.each(formattableInputs)(
    '$name keeps its tree and comments, and formats once and for all within the width',
    ({ text }) => {
      const { actual, expected, reparsed } = roundTripOf(text);
      expect(actual).toEqual(expected);
      expect(unexplainedLongLines(reparsed)).toEqual([]);
    },
  );
});

describe('a body whose one statement is a braced block', () => {
  const headers = ['fn f():', 'fn f(): # on f', 'if a:', 'for x in xs:', 'while a:'];
  const leaders = ['# lead', '@Waypoint{"w"}'];
  const blocks = [['g()'], ['g()', 'h()']];

  it('keeps Acceptance 1–3 with comments and annotations before its brace', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...headers),
        fc.array(fc.constantFrom(...leaders), { maxLength: 3 }),
        fc.constantFrom(...blocks),
        fc.boolean(),
        (header, leading, statements, nestedFunction) => {
          const nested = nestedFunction || !header.startsWith('fn');
          const outer = nested ? ['fn outer():'] : [];
          const depth = nested ? '  ' : '';
          const text = lines(
            ...outer,
            `${depth}${header}`,
            ...leading.map((leader) => `${depth}  ${leader}`),
            `${depth}  {`,
            ...statements.map((statement) => `${depth}    ${statement}`),
            `${depth}  }`,
          );
          const { actual, expected } = roundTripOf(text);
          expect(actual).toEqual(expected);
        },
      ),
    );
  });
});

describe('unions, literal types, member parameters and generic patterns (§2, §3.5, §3.11)', () => {
  it('prints each as written', () => {
    const text = lines(
      'type Status = "draft" | "sent" | -1 | true',
      'fn describe<S in Status, T>(s: S, f: (fn() -> T) | None) -> fn() -> Int | String?:',
      '  match s:',
      '    case Entry<Settings, "region">{value}: value',
      '    case Box<Int | None> as b: b',
      '    case _: f(a<1>(b), a<b | c>(d))',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('keeps Acceptance 1–3 for any type made of unions, literals, optionals and function types', () => {
    fc.assert(
      fc.property(typeTree, (tree) => {
        const { actual, expected } = roundTripOf(lines(`type T = ${printType(tree)}`));
        expect(actual).toEqual(expected);
      }),
    );
  });
});

describe('key types and mapped struct types (§3.1)', () => {
  it('prints each as written', () => {
    const text = lines(
      'type Keys<S is struct> = keyof S | keyof S["meta"]',
      'type Mapped<S is struct> = { id: String, [F in keyof S]: S[F]?, tag: (keyof S)? }',
      'fn read<S is struct, K in keyof S>(s: S, k: K) -> S[K]: s[k]',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('breaks a long mapped struct type into lines, one entry each', () => {
    const text = lines(
      'type Long<S is struct> = {',
      '  identifier: String',
      '  [Field in keyof S]: Array<Map<String, S[Field]>>',
      '  annotation: String',
      '}',
    );
    expect(formatText(text)).toBe(text);
  });
});

describe('comprehensions over fields (§3.1, §4)', () => {
  it('prints an array and a struct comprehension as written, and breaks a long one inside', () => {
    const text = lines(
      'fn f<S is struct>(s: S) -> { [F in keyof S]: S[F] }:',
      '  const keys = [for k, _ in ...s: k]',
      '  struct{for k, v in ...s: [k]: v}',
    );
    expect(formatText(text)).toBe(text);
    const long = lines(
      'fn g(s: Settings):',
      '  struct{first: compute(s.first, 1), second: compute(s.second, 2), for key, value in ...s.rest: [key]: compute(value, 3)}',
    );
    const broken = formatText(long) ?? '';
    expect(broken).toContain('\n  for key, value in ...s.rest: [key]: compute(value, 3)\n}');
    expect(formatText(broken)).toBe(broken);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });
});

describe('field loops (§4)', () => {
  it('prints each as written, labelled or not, its targets destructured', () => {
    const text = lines(
      'fn f<S is struct>(s: S, shared: Box):',
      '  outer: for key, (first, _) in ...s:',
      '    for _, value in ...*shared: continue outer',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });
});

describe('type `match` (§3.17)', () => {
  it('prints its cases a line each, a case type after its colon, `infer` as written', () => {
    const text = lines(
      'type DataOf<D> = match D:',
      '  case Field<infer T is Encodable & Sendable>: T',
      '  case Pair<infer T, T>: Array<T>',
      '  case struct { id: infer K, [_] is Sendable }: K',
      '  case struct: { [F in keyof D]: DataOf<D[F]> }',
      '  case _: Never',
      'struct Wrapper<D>:',
      '  value: D',
      '  type Out = match (D,):',
      '    case (Int | String,): D',
      '    case _: Unit',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('puts a case type below its case when it is written there or too long', () => {
    const below = lines('type Short<T> = match T:', '  case Field<infer V>:', '    V');
    expect(formatText(below)).toBe(lines('type Short<T> = match T:', '  case Field<infer V>: V'));
    const long = lines(
      'type Long<T> = match T:',
      '  case Field<infer Value>:',
      '    { identifier: String, description: String, annotation: Value, other: Array<Value> }',
    );
    expect(formatText(long)).toBe(long);
  });
});

describe('refusing', () => {
  it('a tree with syntax diagnostics', () => {
    const tree = parseText('fn f(:\n  1\n');
    expect(tree.diagnostics.length).toBeGreaterThan(0);
    expect(formatTree(tree)).toBeUndefined();
    expect(formatText('fn f(:\n  1\n')).toBeUndefined();
  });
});

describe('the canonical style', () => {
  it('indents by two, puts a one-item body on its header line, and breaks bracketed lists past the width', () => {
    const long = 'x'.repeat(40);
    expect(
      formatText(
        lines(
          'fn f(a: Int) -> Int:',
          '        return a',
          `fn g(): call(${long}, ${long}, ${long})`,
        ),
      ),
    ).toBe(
      lines(
        'fn f(a: Int) -> Int: return a',
        'fn g():',
        '  call(',
        `    ${long}`,
        `    ${long}`,
        `    ${long}`,
        '  )',
      ),
    );
  });

  it('keeps an item that opens a body off its header line, so an else stays with the outer if', () => {
    const text = lines('fn f():', '  if a:', '    if b: x', '  else: y');
    expect(formatText(text)).toBe(text);
  });

  it('lines an else of an if written as a value up with the line the if starts on', () => {
    expect(
      formatText(lines('fn f():', '  const v = if a:', '      1', '  else:', '      2', '  v')),
    ).toBe(lines('fn f():', '  const v = if a: 1 else: 2', '  v'));
    const long = 'y'.repeat(60);
    expect(formatText(lines('fn f():', `  const v = if a: ${long} else: ${long}`, '  v'))).toBe(
      lines('fn f():', `  const v = if a: ${long}`, `  else: ${long}`, '  v'),
    );
  });

  it('prints struct declarations indented, and anonymous struct types in braces', () => {
    expect(formatText('struct Req { id: Int, data: struct { v: Int } }\n')).toBe(
      lines('struct Req:', '  id: Int', '  data: { v: Int }'),
    );
  });

  it("prints a variant's fields as parameters: on its line when they fit, else one per line", () => {
    expect(
      formatText('enum Node { Group(title: String, open = false, ...children: Array<Node>) }\n'),
    ).toBe(lines('enum Node:', '  Group(title: String, open = false, ...children: Array<Node>)'));
    expect(formatText('enum E { V(), W(\n  # none yet\n) }\n')).toBe(
      lines('enum E:', '  V', '  W(', '    # none yet', '  )'),
    );
    const long = `${'f'.repeat(80)}: String`;
    expect(formatText(lines('enum Wide:', `  Pair(${long}, second: Int = 1)`))).toBe(
      lines('enum Wide:', '  Pair(', `    ${long}`, '    second: Int = 1', '  )'),
    );
  });

  it("prints a call pattern's arguments as a call's: on its line when they fit, else one per line", () => {
    const matching = (pattern: string) =>
      lines('fn f(n: Node) -> Int:', '  match n:', `    case ${pattern}: 1`);
    expect(formatText(matching('Group( title ,...kids,open: true )'))).toBe(
      matching('Group(title, ...kids, open: true)'),
    );
    expect(formatText(matching('Rejected("legal",...)'))).toBe(matching('Rejected("legal", ...)'));
    const long = `"${'t'.repeat(80)}"`;
    expect(formatText(matching(`Group(${long}, ...)`))).toBe(
      lines(
        'fn f(n: Node) -> Int:',
        '  match n:',
        '    case Group(',
        `      ${long}`,
        '      ...',
        '    ):',
        '      1',
      ),
    );
  });

  it('keeps one blank line where the source had any between items', () => {
    expect(formatText(lines('const a = 1', '', '', '', 'const b = 2', 'const c = 3'))).toBe(
      lines('const a = 1', '', 'const b = 2', 'const c = 3'),
    );
  });

  it('keeps a comment after a header on its line, and one ending a body in that body', () => {
    const text = lines(
      'fn f(a: Int): # about f',
      '  g(a)',
      '  # still in f',
      '',
      'fn g(b: Int): b',
    );
    expect(formatText(text)).toBe(text);
  });

  it('keeps a comment closing a list of members or cases in that list, after its comments', () => {
    const text = lines(
      'struct S:',
      '  a: Int # on a',
      '  # end of S',
      'fn f():',
      '  match x:',
      '    case 1: a',
      '    # end of cases',
      '  y',
    );
    expect(formatText(text)).toBe(text);
  });

  it('hugs a last lambda argument and a bracketed body, breaking inside them', () => {
    const body = 'assertEq(compute(1), compute(2), "one call to each of the two")';
    const text = lines(
      'fn tests() -> Array<Test>: [',
      '  test("one", fn(): {',
      `    ${body}`,
      `    ${body}`,
      '  })',
      ']',
    );
    expect(formatText(text)).toBe(text);
  });

  it('moves a multi-line literal with the line it starts on, keeping its value', () => {
    const text = lines(
      'fn f():',
      '    const m = `',
      '        Dear ${name},',
      '          hi',
      '        `',
      '    m',
    );
    expect(formatText(text)).toBe(
      lines('fn f():', '  const m = `', '      Dear ${name},', '        hi', '      `', '  m'),
    );
  });

  it('moves the blank lines of a multi-line literal, keeping the spaces its value holds', () => {
    const text = lines(
      'fn f():',
      '    const m = `',
      '        a',
      '  ',
      '          ',
      '        b',
      '        `',
      '    m',
    );
    expect(formatText(text)).toBe(
      lines('fn f():', '  const m = `', '      a', '', '        ', '      b', '      `', '  m'),
    );
  });

  it('copies a multi-line literal as it stands when moving it would change its value', () => {
    const text = lines('fn f():', '    const m = `a', 'b`', '    m');
    expect(formatText(text)).toBe(lines('fn f():', '  const m = `a', 'b`', '  m'));
  });

  it("lets an operand outside brackets break its own lines at the run's indentation", () => {
    const text = lines(
      'fn f(a: Bool) -> Int:',
      '  const x = 1 + if a:',
      '    const y = 2',
      '    y',
      '  else: 3',
      '  const z = "prefix" + {',
      '    "a"',
      '  }',
      '  x',
    );
    expect(formatText(text)).toBe(text);
  });

  it('keeps an operator run outside brackets whole, and breaks one inside them after its operators', () => {
    const operand = 'z'.repeat(30);
    const run = `${operand} + ${operand} + ${operand} + ${operand}`;
    expect(formatText(lines('fn f():', `  const s = ${run}`, `  g((${run}))`))).toBe(
      lines(
        'fn f():',
        `  const s = ${run}`,
        '  g(',
        '    (',
        `      ${operand} +`,
        `        ${operand} +`,
        `        ${operand} +`,
        `        ${operand}`,
        '    )',
        '  )',
      ),
    );
  });
});
