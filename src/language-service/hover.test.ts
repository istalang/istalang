import { describe, expect, it } from 'vitest';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';

function hover(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset);
}

describe('hover', () => {
  it("shows a variable's type, at its uses and where it is declared", () => {
    expect(hover('fn f() -> int:', '  let co‸unt = 1', '  count')?.code).toEqual([
      '(variable) count: int',
    ]);
    expect(hover('fn f() -> int:', '  let count = 1', '  count‸')?.code).toEqual([
      '(variable) count: int',
    ]);
  });

  it("shows a function's signature and its docstring", () => {
    const shown = hover(
      'fn twice(n: int, by: int = 2) -> int:',
      '  """Doubles `n`."""',
      '  n * by',
      '',
      'fn main() -> int: tw‸ice(1)',
    );
    expect(shown?.code).toEqual(['fn twice(n: int, by: int = …) -> int']);
    expect(shown?.doc).toBe('Doubles `n`.');
  });

  it('shows the field and the variable a shorthand names', () => {
    const shown = hover(
      'struct Pair:',
      '  first: int',
      '',
      'fn f(first: int) -> Pair: Pair{fi‸rst}',
    );
    expect(shown?.code).toEqual(['(field) first: int', '(variable) first: int']);
  });

  it('shows the type of an expression no name stands for', () => {
    expect(hover('fn f() -> int: 1 ‸+ 2')?.code).toEqual(['int']);
    expect(
      hover(
        'struct P:',
        '  a: int',
        '',
        'fn size(self: P) -> int: self.a',
        '',
        'fn g(p: P) -> int: p.size‸() + 1',
      )?.code,
    ).toEqual(['int']);
  });

  it("shows a construct's type on its own keywords, braces and text", () => {
    expect(hover('fn f(c: bool) -> int: i‸f c: 1 else: 2')?.code).toEqual(['int']);
    expect(hover('fn f(c: bool) -> int: if c: 1 el‸se: 2')?.code).toEqual(['int']);
    expect(hover('fn f() -> int: ‸{ const a = 1; a }')?.code).toEqual(['int']);
    expect(hover('fn f() -> string: "he‸llo"')?.code).toEqual(['string']);
  });

  it('shows the member a `->` reads, not the value behind the shared struct', () => {
    const counter = ['shared struct Counter:', '  count: int', ''];
    expect(hover(...counter, 'fn f(c: Counter?) -> int?: c?‸->count')?.code).toEqual(['int?']);
  });

  it("shows a local function's docstring", () => {
    const local = ['fn f() -> int:', '  fn next() -> int:', '    """One more."""', '    1'];
    expect(hover(...local, '  nex‸t()')?.doc).toBe('One more.');
  });

  it('shows an async function as declared', () => {
    expect(hover('async fn lat‸er() -> Future<int>: 1')?.code).toEqual([
      'async fn later() -> Future<int>',
    ]);
  });

  it('shows the arguments of a call being typed after a named argument', () => {
    const connect = 'fn connect(host: string, port: int) -> int: port';
    expect(hover(connect, 'fn f() -> int: connect(host: "x‸", po')?.code).toEqual(['string']);
  });

  it('shows a written type with its type arguments', () => {
    const pair = ['struct Pair<A, B>:', '  first: A', '  second: B', ''];
    expect(hover(...pair, 'fn f(p: Pa‸ir<int, string>) -> int: 1')?.code).toEqual([
      '(type) Pair<int, string>',
    ]);
    expect(hover('fn f(p: (int‸, string)) -> int: 1')?.code).toEqual(['(int, string)']);
    expect(hover('fn f(g: fn(int) ‸-> bool) -> int: 1')?.code).toEqual(['fn(int) -> bool']);
  });

  it("shows a variant's enum wherever the variant is named", () => {
    const color = ['enum Color { Red; Green }', ''];
    const shown = '(variant) Red: Color';
    expect(hover('enum Color { R‸ed; Green }')?.code).toEqual([shown]);
    expect(hover(...color, 'fn f() -> Color: Color.R‸ed')?.code).toEqual([shown]);
    expect(
      hover(
        ...color,
        'fn f(c: Color) -> int:',
        '  match c:',
        '    case R‸ed: 1',
        '    case Green: 2',
      )?.code,
    ).toEqual([shown]);
    const opt = ['enum Opt<T>:', '  Some { value: T }', '  None', ''];
    expect(hover(...opt, 'fn f() -> Opt<int>: So‸me{value: 1}')?.code).toEqual([
      '(variant) Some: Opt<int>',
    ]);
    expect(hover(...opt, 'fn f() -> Opt<int>: Opt.So‸me{value: 1}')?.code).toEqual([
      '(variant) Some: Opt<int>',
    ]);
    expect(
      hover(
        ...opt,
        'fn f(o: Opt<int>) -> int:',
        '  match o:',
        '    case So‸me{value}: value',
        '    case None: 0',
      )?.code,
    ).toEqual(['(variant) Some: Opt<T>']);
  });

  it('shows nothing where nothing has a type', () => {
    expect(hover('fn f() -> int:', '  le‸t x = 1', '  x')).toBeUndefined();
  });
});
