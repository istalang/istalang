/**
 * Patterns and the operators on optionals and results (§3.11, §3.12, §4), as checking a program
 * reports them: what the corpus (test/corpus/patterns/) can't state, such as warnings, and each
 * rule's cases one by one. Running them is the corpus's job.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { diagnosedAt } from '../compile.test-kit.ts';
import { reported } from './check.test-kit.ts';
import { checkerDiagnostics as reports } from './diagnostics/index.ts';

const shapes = [
  'enum Color { Red, Green, Blue }',
  'enum Shape:',
  '  Circle { radius: Int }',
  '  Square { side: Int }',
  'struct Point { x: Int, y: Int }',
  'struct Box { opt: Int? }',
  '',
].join('\n');

/** A `match` on `value: type` with `cases`, in a function after the shapes above. */
function matching(type: string, cases: string): string {
  return `${shapes}\nfn f(value: ${type}) -> String:\n${indent(`match value:\n${indent(cases)}`)}\n`;
}

describe('exhaustiveness', () => {
  it.each([
    ['every variant', 'Color', 'case Red: "r"\ncase Green: "g"\ncase Blue: "b"'],
    ['a wildcard', 'Color', 'case Red: "r"\ncase _: "other"'],
    ['true and false', 'Bool', 'case true: "t"\ncase false: "f"'],
    ['a member and none', 'Int?', 'case Int as n: String(n)\ncase none: "none"'],
    ['a binding name', 'Int', 'case n: String(n)'],
    [
      'a tuple of enums, by product',
      '(Bool, Bool)',
      ['case (true, true): "a"', 'case (true, false): "b"', 'case (false, _): "c"'].join('\n'),
    ],
    ['fields of a variant', 'Shape', 'case Circle{radius}: "c"\ncase Square{}: "s"'],
    ['a struct taken apart', 'Point', 'case Point{x == 0}: "axis"\ncase Point{}: "elsewhere"'],
    [
      '== against a variant',
      'Shape?',
      [
        'case Circle{radius == 1}: "unit"',
        'case Circle{}: "circle"',
        'case Square{}: "square"',
        'case none: "none"',
      ].join('\n'),
    ],
    ['== against none', 'Box', 'case Box{opt == none}: "none"\ncase Box{opt is Int}: "some"'],
    ['alternatives', 'Color', 'case Red | Green: "warm"\ncase Blue: "cold"'],
    [
      'alternatives nested in a tuple',
      '(Bool, Bool)',
      'case (true | false, true): "t"\ncase (_, false): "f"',
    ],
    [
      'arrays by length',
      'Array<Int>',
      'case []: "none"\ncase [x]: "one"\ncase [x, y, ...rest]: "more"',
    ],
    [
      'a rest at either end',
      'Array<Bool>',
      'case [..._, true]: "t"\ncase [false, ..._]: "f"\ncase [true, ...middle, false]: "tf"\ncase []: "e"',
    ],
  ])('is met by %s', (_case, type, cases) => {
    expect(reported(matching(type, cases))).toEqual(reportedNothing);
  });

  it.each([
    ['a missing variant', 'Color', 'case Red: "r"\ncase Green: "g"'],
    ['literals of int, never all of them', 'Int', 'case 0: "zero"\ncase 1: "one"'],
    ['a guarded case', 'Color', 'case c if c == Red: "r"\ncase Green: "g"\ncase Blue: "b"'],
    ['a comparison acting as a guard', 'Point', 'case Point{x > 0}: "right"'],
    ['a missing combination', '(Bool, Bool)', 'case (true, _): "a"\ncase (_, true): "b"'],
    ['arrays of only some lengths', 'Array<Int>', 'case []: "none"\ncase [x]: "one"'],
    ['an alternative acting as a guard', 'Point', 'case Point{x > 0} | Point{y > 0}: "q"'],
    ['ranges, which act as guards', 'Int', 'case ..0: "n"\ncase 0..: "p"'],
  ])('reports %s', (_case, type, cases) => {
    expect(reported(matching(type, cases))).toEqual(
      reportedOnce(reports.nonExhaustiveMatch.code, 'value'),
    );
  });

  it.each([
    ['a case after every value', 'Color', 'case _: "any"\ncase Red: "r"', 'Red'],
    ['a variant listed twice', 'Color', 'case Red: "r"\ncase Red: "again"\ncase _: "o"', 'Red'],
    ['a guarded case covered before it', 'Bool', 'case _: "any"\ncase b if b: "t"', 'b'],
    ['an array no length is left for', 'Array<Int>', 'case [..._]: "any"\ncase [x]: "one"', '[x]'],
    ['a negated zero after zero', 'Int', 'case 0: "z"\ncase -0: "again"\ncase _: "o"', '-0'],
    [
      'a negated float zero after zero',
      'Float',
      'case 0.0: "z"\ncase -0.0: "again"\ncase _: "o"',
      '-0.0',
    ],
    [
      'alternatives covered before them',
      'Color',
      'case Red | Blue: "rb"\ncase Green: "g"\ncase Red | Green: "again"',
      'Red | Green',
    ],
  ])('warns of %s', (_case, type, cases, spanText) => {
    const { codes, spanTexts } = reported(matching(type, cases));
    expect(codes).toEqual([reports.unreachableCase.code]);
    expect(spanTexts.at(-1)).toBe(spanText);
  });
});

describe("'?' on a Result", () => {
  it('passes on an Err from a function whose result is inferred as a Result', () => {
    const text = [
      'fn parse(text: String) -> Result<Int>: Result.Ok{1}',
      'fn twice(text: String):',
      '  const n = parse(text)?',
      '  Result.Ok{n * 2}',
      'async fn main() -> Future<Result<Int>>:',
      '  const n = (await later())?',
      '  Ok{(n)}',
      'async fn later() -> Future<Result<Int>>: parse("1")',
    ].join('\n');
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('is refused outside any function', () => {
    const text = 'fn parse() -> Result<Int>: Result.Ok{1}\nfn f(n: Int = parse()?) -> Int: n\n';
    expect(reported(text)).toEqual(reportedOnce(reports.propagateOutsideFunction.code, 'parse()?'));
  });
});

describe('a Result that must be used', () => {
  const declarations = [
    'struct Form { name: String }',
    'fn validate(self: Form) -> Result<Int>: Result.Ok{1}',
    'fn twice(r: Result<Int>) -> (Result<Int>, Int): (r, 2)',
    'fn f(form: Form?):',
  ];

  it.each([
    ["through '?.', as a Result?", '  form?.validate()', 'form?.validate()'],
    ['inside a tuple', '  twice(Ok{1})', 'twice(Ok{1})'],
  ])('is reported when lost %s', (_case, line, spanText) => {
    expect(reported([...declarations, line, '  0'].join('\n'))).toEqual(
      reportedOnce(reports.unusedValue.code, spanText),
    );
  });

  it.each([
    ['the Result itself', '  twice(Ok{1}).0', true],
    ["a Result? from '?.'", '  form?.validate()', false],
    ['a tuple holding a Result', '  twice(Ok{1})', false],
  ])("advises '?' only for %s", (_case, line, advisesPropagate) => {
    const { diagnostics } = diagnosedAt(
      stdProgramOf({ 'main.ista': [...declarations, line, '  0'].join('\n') }),
      'main.ista',
    );
    const lost = diagnostics.find(({ code }) => code === reports.unusedValue.code);
    expect(lost?.message.includes("'?'")).toBe(advisesPropagate);
  });
});

describe('optional operators', () => {
  const chained = [
    'struct Inner { zip: Int?, code: Int }',
    'struct Outer { inner: Inner? }',
    'struct Plain { inner: Inner }',
    'fn f(outer: Outer?, plain: Plain?):',
  ];

  it.each([
    ["'?.' wraps a plain value once", 'const v: Int? = outer?.inner?.code'],
    ["'?.' keeps an optional value as it is", 'const v: Int? = outer?.inner?.zip'],
    ['a chain carries on through a plain link', 'const v: Int? = plain?.inner.code'],
    ["'??' with a plain right side gives the plain type", 'const v: Int = outer?.inner?.code ?? 0'],
    [
      "'??' with an optional right side gives an optional",
      'const v: Int? = outer?.inner?.zip ?? none',
    ],
  ])('%s', (_case, line) => {
    expect(reported([...chained, `  ${line}`, '  v'].join('\n'))).toEqual(reportedNothing);
  });

  it("refuses '??' giving a plain value where its right side is optional", () => {
    const lines = ['  const fallback: Int? = 1', '  const v: Int = outer?.inner?.zip ?? fallback'];
    expect(reported([...chained, ...lines, '  v'].join('\n')).codes).toEqual([
      reports.typeMismatch.code,
    ]);
  });

  it.each([
    ["'!' gives the value inside", 'const v: Int = outer!.inner!.code', 'outer!.inner!'],
    [
      "'!' unwraps the whole chain before it",
      'const v: Int = (outer?.inner?.zip)!',
      '(outer?.inner?.zip)!',
    ],
    [
      "'!' after a chain without parentheses",
      'const v: Int = outer?.inner?.code!',
      'outer?.inner?.code!',
    ],
  ])('warns at every %s', (_case, line, spanText) => {
    const { codes, spanTexts } = reported([...chained, `  ${line}`, '  v'].join('\n'));
    expect(codes.every((code) => code === reports.forceUnwrap.code)).toBe(true);
    expect(spanTexts.at(-1)).toBe(spanText);
  });

  it("refuses '!' on a value that isn't optional", () => {
    const lines = [...chained, '  const n = 1', '  n!'];
    expect(reported(lines.join('\n')).codes).toEqual([
      reports.needsOptional.code,
      reports.forceUnwrap.code,
    ]);
  });

  it.each([
    ['right after the ?.', 'outer?.reset()', 'outer'],
    ['on a later link', 'plain?.inner.reset()', 'plain?.inner'],
  ])("refuses a '&self' method through a chain, %s, as no place", (_case, call, receiver) => {
    const lines = ['fn reset(self: &Inner): self.code = 0', ...chained, `  ${call}`];
    expect(reported(lines.join('\n'))).toEqual(
      reportedOnce(reports.receiverNotPlace.code, receiver),
    );
  });
});

describe('comparison and membership resolution', () => {
  const ambiguous = [
    'struct P { x: Int }',
    'fn compare<T>(a: P, b: T) -> Int: 0',
    'fn compare<T>(a: T, b: P) -> Int: 0',
    'struct Holder { item: P }',
    'fn f(p: P, h: Holder) -> Bool:',
  ];

  it.each([
    ['a binary comparison', '  p < p', 'p < p'],
    ['a chained comparison link', '  p < p < p', 'p < p'],
    ['a pattern field ordering', '  h is Holder{item < p}', 'item < p'],
  ])('reports an ambiguous compare on %s', (_case, line, spanText) => {
    const { codes, spanTexts } = reported([...ambiguous, line].join('\n'));
    expect(codes[0]).toBe(reports.ambiguousCall.code);
    expect(spanTexts[0]).toBe(spanText);
  });

  const unmetConstraint = [
    'struct P { x: Int }',
    'struct Wrap<T> { inner: T }',
    'fn compare<T is Comparable>(a: Wrap<T>, b: Wrap<T>) -> Int: compare(a.inner, b.inner)',
    'struct Holder { item: Wrap<P> }',
    'fn f(w: Wrap<P>, h: Holder) -> Bool:',
  ];

  it.each([
    ['a binary comparison', '  w < w', 'w < w'],
    ['a chained comparison link', '  w < w < w', 'w < w'],
    ['a pattern field ordering', '  h is Holder{item < w}', 'item < w'],
  ])('reports an unmet constraint on %s', (_case, line, spanText) => {
    const { codes, spanTexts } = reported([...unmetConstraint, line].join('\n'));
    expect(codes[0]).toBe(reports.notConforming.code);
    expect(spanTexts[0]).toBe(spanText);
  });
});

describe("an Error's trace", () => {
  it('may be left out of an Error only', () => {
    const text = [
      'struct Note { message: String, trace: String }',
      'fn f():',
      '  const e = Error{message: "m", code: "c"}',
      '  const n = Note{message: "m"}',
    ].join('\n');
    expect(reported(text)).toEqual(reportedOnce(reports.missingField.code, 'Note'));
  });
});

describe('a pattern naming nothing', () => {
  const named = [
    'trait Named:',
    '  fn name(self: Self) -> String',
    'fn name(self: Point) -> String: "p"',
  ];

  it.each([
    ['a struct pattern cut short', 'Point', 'case Point.{x}: x\ncase _: 0', '{'],
    ['a destructuring cut short', 'Point', 'const Point.{x} = value\nx', '{'],
    ['a downcast cut short', 'any Named', 'case Point.{x}: x\ncase _: 0', '{'],
    ['a downcast to a name cut short', 'any Named', 'case Point.: 1\ncase _: 0', ':'],
  ])('reports %s at the missing name only', (_case, type, body, spanText) => {
    const cases = body.startsWith('case') ? `match value:\n${indent(body)}` : body;
    const text = [shapes, ...named, `fn f(value: ${type}) -> Int:`, indent(cases), ''].join('\n');
    expect(reported(text)).toEqual(reportedOnce(2001, spanText));
  });

  it.each([
    ['a struct pattern', 'case Pont{x}: x\ncase _: 0'],
    ['a destructuring', 'const Pont{x} = value\nx'],
  ])('reports %s whose name is undeclared at the name only', (_case, body) => {
    const cases = body.startsWith('case') ? `match value:\n${indent(body)}` : body;
    const text = [shapes, 'fn f(value: Point) -> Int:', indent(cases), ''].join('\n');
    expect(reported(text)).toEqual(reportedOnce(4000, 'Pont'));
  });
});

function indent(lines: string): string {
  return lines
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
