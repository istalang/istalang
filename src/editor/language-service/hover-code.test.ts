/**
 * What a hover shows beyond a name's line: code laid out within the hover's width, a declared
 * type's declaration, the comments above a declaration with its docstring, and the declared types
 * its code names.
 */

import { describe, expect, it } from 'vitest';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';

function hover(...lines: readonly string[]) {
  return (({ program, module, offset }) => hoverAt(program, module, offset))(programAt(...lines));
}

const point = ['struct Point:', '  x: Int', '  y: Int', ''];

describe('hover code', () => {
  it("breaks a signature past the hover's width, one parameter a line", () => {
    const signature =
      'fn place(firstPoint: Point, secondPoint: Point, label: String, scale: Int = 1) -> Point';
    expect(hover(...point, `${signature}: firstPoint`, 'fn main() -> Point: pla‸ce')?.code).toEqual(
      [
        [
          'fn place(',
          '  firstPoint: Point',
          '  secondPoint: Point',
          '  label: String',
          '  scale: Int = …',
          ') -> Point',
        ].join('\n'),
        'sendable fn(Point, Point, String, Int) -> Point',
      ],
    );
  });

  it('shows a struct, an enum and a trait by their declarations, with no bodies or docstrings', () => {
    expect(hover(...point, 'fn f(p: Poi‸nt) -> Int: p.x')?.code).toEqual([
      'struct Point { x: Int, y: Int }',
    ]);
    const shape = ['enum Shape:', '  Circle(radius: Int)', '  Square(side: Int)', ''];
    expect(hover(...shape, 'fn f(s: Sha‸pe) -> Int: 1')?.code).toEqual([
      'enum Shape { Circle(radius: Int), Square(side: Int) }',
    ]);
    const trait = [
      'trait Sized:',
      '  """Has a size."""',
      '  fn size(self: Self) -> Int',
      '  fn doubled(self: Self) -> Int:',
      '    """Twice its size."""',
      '    self.size() * 2',
      '',
    ];
    expect(hover(...trait, 'fn f<T is Si‸zed>(t: T) -> Int: t.size()')?.code).toEqual([
      ['trait Sized:', '  fn size(self: Self) -> Int', '  fn doubled(self: Self) -> Int'].join(
        '\n',
      ),
    ]);
  });

  it('says how many members a long declaration has past those it shows', () => {
    const fields = Array.from({ length: 23 }, (_, index) => `  f${index}: Int`);
    const [code] = hover('struct Wide:', ...fields, '', 'fn f(w: Wi‸de) -> Int: 1')?.code ?? [];
    const lines = code?.split('\n') ?? [];
    expect(lines).toHaveLength(22);
    expect(lines.at(-2)).toBe('  f19: Int');
    expect(lines.at(-1)).toBe('  # … 3 more');
  });
});

describe('hover documentation', () => {
  it('shows the comments right above a declaration, then its docstring', () => {
    const shown = hover(
      '# Doubles `n`,',
      '# by `by`.',
      'fn twice(n: Int, by: Int = 2) -> Int:',
      '  """Exact for any `Int`."""',
      '  n * by',
      '',
      'fn main() -> Int: tw‸ice(1)',
    );
    expect(shown?.doc).toBe('Doubles `n`,\nby `by`.\n\nExact for any `Int`.');
  });

  it('shows no comment a blank line parts from it, nor one above a line it shares', () => {
    expect(hover('# A banner.', '', 'const limit = 3', 'fn f() -> Int: lim‸it')?.doc).toBe(
      undefined,
    );
    const braced = ['# Two numbers.', 'struct Pair { first: Int, second: Int }', ''];
    expect(hover(...braced, 'fn f(p: Pair) -> Int: p.fir‸st')?.doc).toBe(undefined);
    expect(hover(...braced, 'fn f(p: Pa‸ir) -> Int: 1')?.doc).toBe('Two numbers.');
  });

  it("shows a field's and a variant's comments", () => {
    const shape = ['enum Shape:', '  # Round.', '  Circle(radius: Int)', ''];
    expect(hover(...shape, 'fn f() -> Shape: Cir‸cle(1)')?.doc).toBe('Round.');
    const sized = ['struct Box:', '  # In pixels.', '  width: Int', ''];
    expect(hover(...sized, 'fn f(b: Box) -> Int: b.wid‸th')?.doc).toBe('In pixels.');
  });
});

describe('hover links', () => {
  it('links each declared type the code names, once, a std one included, and no primitive', () => {
    const order = ['struct Order:', '  at: Point', ''];
    const shown = hover(
      ...point,
      ...order,
      'fn move(order: Order, by: Point) -> Array<Point>: [by]',
      'fn main() -> Int: mo‸ve',
    );
    expect(shown?.links.map(({ text, module }) => [text, module.startsWith('std:')])).toEqual([
      ['Order', false],
      ['Point', false],
      ['Array', true],
    ]);
  });
});
