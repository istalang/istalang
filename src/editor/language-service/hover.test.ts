/**
 * Hover over single programs: what a name, a key naming a field, an expression and a written type
 * show, a spelling with what it names beside it.
 */

import { describe, expect, it } from 'vitest';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';

const namesDuration = /Duration/u;

function hover(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset);
}

describe('hover', () => {
  it("shows a variable's type, at its uses and where it is declared", () => {
    expect(hover('fn f() -> Int:', '  let co‸unt = 1', '  count')?.code).toEqual([
      '(variable) count: Int',
    ]);
    expect(hover('fn f() -> Int:', '  let count = 1', '  count‸')?.code).toEqual([
      '(variable) count: Int',
    ]);
  });

  it("shows a function's signature and its docstring", () => {
    const shown = hover(
      'fn twice(n: Int, by: Int = 2) -> Int:',
      '  """Doubles `n`."""',
      '  n * by',
      '',
      'fn main() -> Int: tw‸ice(1)',
    );
    expect(shown?.code).toEqual(['fn twice(n: Int, by: Int = …) -> Int']);
    expect(shown?.doc).toBe('Doubles `n`.');
  });

  it('shows the export a renaming import binds, at its alias, its uses and its exported name', () => {
    expect(hover("import (Dura‸tion as Span) from 'time'")?.code?.[0]).toMatch(namesDuration);
    expect(hover("import (Duration as Sp‸an) from 'time'")?.code?.[0]).toMatch(namesDuration);
    expect(
      hover("import Duration as Span from 'time'", 'fn f(s: Sp‸an) -> Int: s.value')?.code?.[0],
    ).toMatch(namesDuration);
  });

  it('shows the field and the variable a shorthand names', () => {
    const shown = hover(
      'struct Pair:',
      '  first: Int',
      '',
      'fn f(first: Int) -> Pair: Pair{fi‸rst}',
    );
    expect(shown?.code).toEqual(['(field) first: Int', '(variable) first: Int']);
  });

  it('shows the type of an expression no name stands for', () => {
    expect(hover('fn f() -> Int: 1 ‸+ 2')?.code).toEqual(['Int']);
    expect(
      hover(
        'struct P:',
        '  a: Int',
        '',
        'fn size(self: P) -> Int: self.a',
        '',
        'fn g(p: P) -> Int: p.size‸() + 1',
      )?.code,
    ).toEqual(['Int']);
  });

  it("shows a construct's type on its own keywords, braces and text", () => {
    expect(hover('fn f(c: Bool) -> Int: i‸f c: 1 else: 2')?.code).toEqual(['Int']);
    expect(hover('fn f(c: Bool) -> Int: if c: 1 el‸se: 2')?.code).toEqual(['Int']);
    expect(hover('fn f() -> Int: ‸{ const a = 1; a }')?.code).toEqual(['Int']);
    expect(hover('fn f() -> String: "he‸llo"')?.code).toEqual(['String']);
  });

  it('shows the member a `->` reads, not the value behind the shared struct', () => {
    const counter = ['shared struct Counter:', '  count: Int', ''];
    expect(hover(...counter, 'fn f(c: Counter?) -> Int?: c?‸->count')?.code).toEqual(['Int?']);
  });

  it("shows a local function's docstring", () => {
    const local = ['fn f() -> Int:', '  fn next() -> Int:', '    """One more."""', '    1'];
    expect(hover(...local, '  nex‸t()')?.doc).toBe('One more.');
  });

  it('shows an async function as declared', () => {
    expect(hover('async fn lat‸er() -> Future<Int>: 1')?.code).toEqual([
      'async fn later() -> Future<Int>',
    ]);
  });

  it('shows the arguments of a call being typed after a named argument', () => {
    const connect = 'fn connect(host: String, port: Int) -> Int: port';
    expect(hover(connect, 'fn f() -> Int: connect(host: "x‸", po')?.code).toEqual(['String']);
  });

  it("shows a type pattern's binding with the type it names", () => {
    const matched = ['fn f(x: any Stringable) -> Int:', '  match x:', '    case Int as ‸n: n'];
    expect(hover(...matched, '    case _: 0')?.code).toEqual(['(variable) n: Int']);
  });

  it('shows a written type with its type arguments', () => {
    const pair = ['struct Pair<A, B>:', '  first: A', '  second: B', ''];
    expect(hover(...pair, 'fn f(p: Pa‸ir<Int, String>) -> Int: 1')?.code).toEqual([
      '(type) Pair<Int, String>',
    ]);
    expect(hover('fn f(p: (Int‸, String)) -> Int: 1')?.code).toEqual(['(Int, String)']);
    expect(hover('fn f(g: fn(Int) ‸-> Bool) -> Int: 1')?.code).toEqual(['fn(Int) -> Bool']);
  });

  it("shows a variant's enum wherever the variant is named", () => {
    const color = ['enum Color { Red, Green }', ''];
    const shown = '(variant) Red: Color';
    expect(hover('enum Color { R‸ed, Green }')?.code).toEqual([shown]);
    expect(hover(...color, 'fn f() -> Color: Color.R‸ed')?.code).toEqual([shown]);
    expect(
      hover(
        ...color,
        'fn f(c: Color) -> Int:',
        '  match c:',
        '    case R‸ed: 1',
        '    case Green: 2',
      )?.code,
    ).toEqual([shown]);
    const opt = ['enum Opt<T>:', '  Some(value: T)', '  None', ''];
    expect(hover(...opt, 'fn f() -> Opt<Int>: So‸me{value: 1}')?.code).toEqual([
      '(variant) Some: Opt<Int>',
    ]);
    expect(hover(...opt, 'fn f() -> Opt<Int>: Opt.So‸me{value: 1}')?.code).toEqual([
      '(variant) Some: Opt<Int>',
    ]);
    expect(
      hover(
        ...opt,
        'fn f(o: Opt<Int>) -> Int:',
        '  match o:',
        '    case So‸me{value}: value',
        '    case None: 0',
      )?.code,
    ).toEqual(['(variant) Some: Opt<T>']);
  });

  it('shows unions, literal types and `None` as written, an alias with what it names, and the type a case leaves', () => {
    const status = ['type Status = "draft" | "sent"', ''];
    expect(hover(...status, 'fn f(x: Int?, s: Status) -> Int?: x‸')?.code).toEqual([
      '(variable) x: Int?',
    ]);
    expect(hover(...status, 'fn f(x: Int?, s: Status) -> Status: s‸')?.code).toEqual([
      '(variable) s: Status = "draft" | "sent"',
    ]);
    expect(hover('fn f(x: "a" | 1 | true) -> Int:', '  const y‸ = x', '  0')?.code).toEqual([
      '(variable) y: "a" | 1 | true',
    ]);
    expect(hover('fn f(x: ‸None) -> Int: 0')?.code).toEqual(['(type) None']);
    expect(hover('fn f() -> Int?: ‸none')?.code).toEqual(['None']);
    const cases = ['fn f(x: Int | String | None) -> Int:', '  match x:', '    case None: 0'];
    expect(hover(...cases, '    case ‸s: 1')?.code).toEqual(['(variable) s: Int | String']);
  });

  it('shows nothing where nothing has a type', () => {
    expect(hover('fn f() -> Int:', '  le‸t x = 1', '  x')).toBeUndefined();
  });
});
