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

  it('shows the function a deferred call gives its taker to, and the call it defers (§3.14)', () => {
    const declared = [
      'fn shown(f: fn() -> Int, times: Int = 3) -> String: String(f())',
      'fn shown(f: fn() -> String, label: String) -> String: f() + label',
      'fn count(n: Int) -> Int: n',
      '',
    ];
    expect(hover(...declared, 'fn f() -> String: sh‸own count(1)')?.code).toEqual([
      'fn shown(f: fn() -> Int, times: Int = …) -> String',
    ]);
    expect(hover(...declared, 'fn f() -> String: shown(times: 2)‸ count(1)')?.code).toEqual([
      'Int',
    ]);
    expect(hover(...declared, 'fn f() -> String: shown(ti‸mes: 2) count(1)')?.code).toEqual([
      '(variable) times: Int',
    ]);
  });

  it("shows a local function's docstring", () => {
    const local = ['fn f() -> Int:', '  fn next() -> Int:', '    """One more."""', '    1'];
    expect(hover(...local, '  nex‸t()')?.doc).toBe('One more.');
  });

  it('shows an inferred inert closure as `inert fn`', () => {
    const inertClosure = [
      'shared struct Counter { count: Int = 0 }',
      'fn f(c: Counter) -> Int:',
      '  const bu‸mp = fn(n: Int): c->count + n',
      '  bump(1)',
    ];
    expect(hover(...inertClosure)?.code).toEqual(['(variable) bump: inert fn(Int) -> Int']);
  });

  it('shows an async function as declared', () => {
    expect(hover('ista async fn lat‸er() -> Int: 1')?.code).toEqual([
      'ista async fn later() -> Int',
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
      'struct Pair<A, B> { first: A, second: B }',
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
  });

  it("shows a variant with fields by its constructor's signature, then its enum (§3.11)", () => {
    const opt = ['enum Opt<T>:', '  Some(value: T)', '  None', ''];
    const signature = 'fn Opt.Some<T>(value: T) -> Opt<T>';
    expect(hover('enum Opt<T> { So‸me(value: T), None }')?.code).toEqual([
      signature,
      '(variant) Some: Opt<T>',
    ]);
    for (const built of ['So‸me(1)', 'Opt.So‸me(1)', 'So‸me(value: 1)']) {
      expect(hover(...opt, `fn f() -> Opt<Int>: ${built}`)?.code).toEqual([
        signature,
        '(variant) Some: Opt<Int>',
      ]);
    }
    expect(hover(...opt, 'const wrap: fn(Int) -> Opt<Int> = Opt.So‸me')?.code).toEqual([
      signature,
      '(variant) Some: Opt<Int>',
    ]);
    expect(
      hover(
        ...opt,
        'fn f(o: Opt<Int>) -> Int:',
        '  match o:',
        '    case So‸me(value): value',
        '    case None: 0',
      )?.code,
    ).toEqual([signature, '(variant) Some: Opt<T>']);
  });

  it('shows a bare variant named before refused braces, as the expected type chooses it', () => {
    const decision = ['enum Decision { Approved(by: String), Expired }', ''];
    expect(hover(...decision, 'fn f() -> Decision: Appro‸ved{by: "x"}')?.code).toEqual([
      'fn Decision.Approved(by: String) -> Decision',
      '(variant) Approved: Decision',
    ]);
  });

  it("names the field a call pattern's argument gives by position, beside what it holds", () => {
    const verdict = [
      'enum Verdict:',
      '  Approved',
      '  Rejected(by: String, reason: String = "none")',
      'enum Node { Group(title: String, ...children: Array<Node>), Leaf }',
      '',
    ];
    const cased = (pattern: string) =>
      hover(
        ...verdict,
        'fn f(v: Verdict) -> Int:',
        '  match v:',
        `    case ${pattern}: 1`,
        '    case _: 0',
      )?.code;
    expect(cased('Rejected(w‸ho, _)')).toEqual(['(field) by: String', '(variable) who: String']);
    expect(cased('Rejected("le‸gal", ...)')).toEqual(['(field) by: String', 'String']);
    expect(cased('Rejected(_, ‸_)')).toEqual(['(field) reason: String']);
    expect(cased('Rejected(by: w‸ho)')).toEqual(['(variable) who: String']);
    const grouped = (pattern: string) =>
      hover(
        ...verdict,
        'fn f(n: Node) -> Int:',
        '  match n:',
        `    case ${pattern}: 1`,
        '    case _: 0',
      )?.code;
    expect(grouped('Group(_, fi‸rst)')).toEqual([
      '(field) children: Array<Node>',
      '(variable) first: Node',
    ]);
    expect(grouped('Group(_, ...ki‸ds)')).toEqual([
      '(field) children: Array<Node>',
      '(variable) kids: Array<Node>',
    ]);
    expect(grouped('Group(_, Gro‸up(t, ...))')?.[0]).toBe(
      'fn Node.Group(title: String, ...children: Array<Node>) -> Node',
    );
    expect(grouped('Group(_, Group(na‸me, ...))')).toEqual([
      '(field) title: String',
      '(variable) name: String',
    ]);
    expect(grouped('Group(_, ...middle, la‸st)')).toEqual([
      '(field) children: Array<Node>',
      '(variable) last: Node',
    ]);
  });

  it("names the field as checking recorded it: at the subject's type arguments, past any pattern but one taking a value apart", () => {
    const verdict = 'enum Verdict { Approved, Rejected(by: String, reason: String = "none") }';
    const score = 'enum Score { Points(n: Int) }';
    const cased = (subject: string, pattern: string) =>
      hover(
        verdict,
        score,
        `fn f(x: ${subject}) -> Int:`,
        '  match x:',
        `    case ${pattern}: 1`,
        '    case _: 0',
      )?.code;
    expect(cased('Result<Int, String>', 'Ok(va‸l)')).toEqual([
      '(field) value: Int',
      '(variable) val: Int',
    ]);
    expect(cased('Result<Int, String>', 'Err(er‸r)')).toEqual([
      '(field) error: String',
      '(variable) err: String',
    ]);
    expect(cased('Verdict', 'Rejected(who‸, _)')).toEqual([
      '(field) by: String',
      '(variable) who: String',
    ]);
    expect(cased('Verdict', 'Rejected("le‸gal" | "ops", _)')?.[0]).toBe('(field) by: String');
    expect(cased('Verdict', 'Rejected("legal" as w‸ho, _)')?.[0]).toBe('(field) by: String');
    expect(cased('Verdict', 'Rejected((w‸ho), _)')?.[0]).toBe('(field) by: String');
    expect(cased('Score', 'Points(1‸..=5)')?.[0]).toBe('(field) n: Int');
    expect(cased('Result<Int>', 'Err(Error{‸message})')).not.toContain('(field) error: Error');
    expect(cased('Verdict', 'Rejected(by: "a", w‸ho)')).not.toContain('(field) by: String');
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

  it('shows the declaration an annotation names even where the parser rejected the annotation', () => {
    const tag = 'struct Tag { label: String }';
    expect(hover(tag, 'fn f<S is struct { @Ta‸g{"a"} n: Int }>(s: S): ()')?.code).toEqual([tag]);
    expect(hover(tag, 'const xs: Array<Int> =', '  @Tag{la‸bel: "a"}', '  - 1')?.code).toEqual([
      '(field) label: String',
    ]);
    expect(hover(tag, 'type Out<T> = match T:', '  @Ta‸g{"a"}', '  case _: Int')?.code).toEqual([
      tag,
    ]);
    expect(hover(tag, 'extern struct Handle:', '  @Ta‸g{"a"}')?.code).toEqual([tag]);
  });
});
