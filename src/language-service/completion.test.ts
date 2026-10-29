import { describe, expect, it } from 'vitest';
import { completionsAt, memberCompletionsAt } from './completion.ts';
import { programAt } from './language-service.test-kit.ts';

function names(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

const time = "import * as time from 'time'";

const pair = [
  'struct Pair:',
  '  first: int',
  '  second: int',
  '',
  'fn sum(self: Pair) -> int: self.first + self.second',
  'fn Pair.zero() -> Pair: Pair{first: 0, second: 0}',
  '',
];

describe('completion', () => {
  it("offers a value's fields and methods after a `.`, while the member is still missing", () => {
    expect(names(...pair, 'fn f(p: Pair) -> int:', '  p.‸', '  1')).toEqual(
      expect.arrayContaining(['first', 'second', 'sum']),
    );
  });

  it('offers the value inside an optional after `?.`', () => {
    expect(names(...pair, 'fn f(p: Pair?) -> int?: p?.fi‸rst')).toEqual(
      expect.arrayContaining(['first', 'second']),
    );
  });

  it("offers a type's statics, and an enum's variants", () => {
    expect(names(...pair, 'fn f() -> Pair: Pair.ze‸ro()')).toContain('zero');
    expect(names('enum Color:', '  Red', '  Green', 'fn f() -> Color: Color.R‸ed')).toEqual([
      'Red',
      'Green',
    ]);
  });

  it('offers what a shared struct holds after `->` and `?->`, before a member is written', () => {
    const counter = ['shared struct Counter:', '  count: int', ''];
    expect(names(...counter, 'fn f(c: Counter) -> int:', '  c->‸', '  1')).toEqual(['count']);
    expect(names(...counter, 'fn f(c: Counter?) -> int:', '  c?->‸', '  1')).toEqual(['count']);
  });

  it("offers a qualified name's later segment in a pattern and in a type", () => {
    const color = ['enum Color:', '  Red', '  Green', ''];
    const matching = [
      'fn f(c: Color) -> int:',
      '  match c:',
      '    case Color.R‸ed: 1',
      '    case _: 2',
    ];
    expect(names(...color, ...matching)).toEqual(['Red', 'Green']);
    const unwritten = [
      'fn f(c: Color) -> int:',
      '  match c:',
      '    case Color.‸:',
      '      1',
      '    case _: 2',
    ];
    expect(names(...color, ...unwritten)).toEqual(['Red', 'Green']);
    const json = "import * as json from 'json'";
    expect(names(json, 'fn f(j: json.Js‸on) -> int: 1')).toContain('Json');
    expect(names(json, 'fn f(j: json.‸) -> int: 1')).toContain('Json');
    expect(names(json, 'fn f() -> int:', '  let j: json.‸ = 1', '  1')).toContain('Json');
  });

  it('offers a method taking `&self` only through a place', () => {
    expect(names('fn f() -> int:', '  let xs = [1]', '  xs.‸', '  1')).toContain('push');
    expect(names('fn f() -> int:', '  [1].‸', '  1')).not.toContain('push');
  });

  it('offers the names visible where the name starts, then keywords', () => {
    const offered = names('fn f(count: int) -> int:', '  let total = 1', '  to‸tal + count');
    expect(offered).toEqual(expect.arrayContaining(['total', 'count', 'f', 'fn', 'while']));
  });

  it('answers members alone only where a member is written', () => {
    const { program, module, offset } = programAt('fn f(a: int) -> bool: a >‸ 1');
    expect(memberCompletionsAt(program, module, offset)).toBeUndefined();
  });

  it("doesn't offer a block's name before its declaration", () => {
    expect(names('fn f() -> int:', '  ‸', '  let later = 1', '  later')).not.toContain('later');
  });

  it('offers nothing after a `.` where no member can stand, a keyword spelling included', () => {
    expect(names(time, 'time.‸', 'fn f() -> int: 1')).toEqual([]);
    expect(names(time, 'time.if‸')).toEqual([]);
    expect(names(time, 'time?.‸')).toEqual([]);
    expect(names('1.‸')).toEqual([]);
    expect(names('enum Color.‸:', '  Red')).toEqual([]);
    expect(names(time, 'const t = time.‸')).toContain('now');
  });

  it('offers nothing after a value that has no members', () => {
    expect(names('fn main() -> int:', '  main.‸', '  1')).toEqual([]);
    expect(names('fn g() -> int: 1', 'fn f() -> int:', '  g.‸', '  1')).toEqual([]);
    expect(names('fn f() -> int:', '  nope.‸', '  1')).toEqual([]);
    expect(names('fn f() -> int:', '  let x = nope', '  x.‸', '  1')).toEqual([]);
    expect(names('fn f(o: int?) -> int:', '  o.‸', '  1')).toEqual([]);
    expect(names('fn f(o: int) -> int:', '  o?.‸', '  1')).toEqual([]);
  });

  it("offers neither a namespace's nor a type's members after `?.`", () => {
    expect(names(time, 'fn f() -> int:', '  time?.‸', '  1')).toEqual([]);
    expect(names(...pair, 'fn f() -> int:', '  Pair?.‸', '  1')).toEqual([]);
  });

  it('offers a member whose name so far spells a keyword', () => {
    const xs = ['fn f(xs: Array<int>, maybe: Array<int>?) -> int:', '  let ys = xs'];
    expect(names(...xs, '  ys.in‸', '  1')).toContain('includes');
    expect(names(...xs, '  maybe?.in‸', '  1')).toContain('includes');
  });

  it('offers the visible names after a `.` that ends the line before', () => {
    expect(names(time, 'time.', 'f‸')).toContain('fn');
    expect(names(time, 'const t: time.', 'fn‸')).toContain('fn');
    expect(names('fn f() -> i‸nt: 1')).toContain('int');
  });
});
