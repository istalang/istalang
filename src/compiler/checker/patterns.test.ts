/**
 * Patterns and the operators on optionals and results (§3.11, §3.12, §4), as checking a program
 * reports them: what the corpus (test/corpus/patterns/) can't state, such as warnings, and each
 * rule's cases one by one. Running them is the corpus's job.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../binder/bind.test-kit.ts';
import { diagnosedAt } from '../compile.test-kit.ts';
import { reported } from './check.test-kit.ts';
import { checkerDiagnostics as reports } from './diagnostics.ts';

const shapes = [
  'enum Color { Red; Green; Blue }',
  'enum Shape:',
  '  Circle { radius: int }',
  '  Square { side: int }',
  'struct Point { x: int; y: int }',
  'struct Box { opt: int? }',
  '',
].join('\n');

/** A `match` on `value: type` with `cases`, in a function after the shapes above. */
function matching(type: string, cases: string): string {
  return `${shapes}\nfn f(value: ${type}) -> string:\n${indent(`match value:\n${indent(cases)}`)}\n`;
}

describe('exhaustiveness', () => {
  it.each([
    ['every variant', 'Color', 'case Red: "r"\ncase Green: "g"\ncase Blue: "b"'],
    ['a wildcard', 'Color', 'case Red: "r"\ncase _: "other"'],
    ['true and false', 'bool', 'case true: "t"\ncase false: "f"'],
    ['Some and none', 'int?', 'case Some{value}: "some"\ncase none: "none"'],
    ['a binding name', 'int', 'case n: string(n)'],
    [
      'a tuple of enums, by product',
      '(bool, bool)',
      ['case (true, true): "a"', 'case (true, false): "b"', 'case (false, _): "c"'].join('\n'),
    ],
    ['fields of a variant', 'Shape', 'case Circle{radius}: "c"\ncase Square{}: "s"'],
    ['a struct taken apart', 'Point', 'case Point{x == 0}: "axis"\ncase Point{}: "elsewhere"'],
    [
      '== against a variant',
      'Shape?',
      [
        'case Some{value is Circle{radius == 1}}: "unit"',
        'case Some{value is Circle{}}: "circle"',
        'case Some{value is Square{}}: "square"',
        'case none: "none"',
      ].join('\n'),
    ],
    ['== against none', 'Box', 'case Box{opt == none}: "none"\ncase Box{opt is Some{}}: "some"'],
  ])('is met by %s', (_case, type, cases) => {
    expect(reported(matching(type, cases))).toEqual(reportedNothing);
  });

  it.each([
    ['a missing variant', 'Color', 'case Red: "r"\ncase Green: "g"'],
    ['literals of int, never all of them', 'int', 'case 0: "zero"\ncase 1: "one"'],
    ['a guarded case', 'Color', 'case c if c == Red: "r"\ncase Green: "g"\ncase Blue: "b"'],
    ['a comparison acting as a guard', 'Point', 'case Point{x > 0}: "right"'],
    ['a missing combination', '(bool, bool)', 'case (true, _): "a"\ncase (_, true): "b"'],
  ])('reports %s', (_case, type, cases) => {
    expect(reported(matching(type, cases))).toEqual(
      reportedOnce(reports.nonExhaustiveMatch.code, 'value'),
    );
  });

  it.each([
    ['a case after every value', 'Color', 'case _: "any"\ncase Red: "r"', 'Red'],
    ['a variant listed twice', 'Color', 'case Red: "r"\ncase Red: "again"\ncase _: "o"', 'Red'],
    ['a guarded case covered before it', 'bool', 'case _: "any"\ncase b if b: "t"', 'b'],
  ])('warns of %s', (_case, type, cases, spanText) => {
    const { codes, spanTexts } = reported(matching(type, cases));
    expect(codes).toEqual([reports.unreachableCase.code]);
    expect(spanTexts.at(-1)).toBe(spanText);
  });
});

describe("'?' on a Result", () => {
  it('passes on an Err from a function whose result is inferred as a Result', () => {
    const text = [
      'fn parse(text: string) -> Result<int>: Result.Ok{1}',
      'fn twice(text: string):',
      '  const n = parse(text)?',
      '  Result.Ok{n * 2}',
      'async fn main() -> Future<Result<int>>:',
      '  const n = (await later())?',
      '  Ok{(n)}',
      'async fn later() -> Future<Result<int>>: parse("1")',
    ].join('\n');
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('is refused outside any function', () => {
    const text = 'fn parse() -> Result<int>: Result.Ok{1}\nfn f(n: int = parse()?) -> int: n\n';
    expect(reported(text)).toEqual(reportedOnce(reports.propagateOutsideFunction.code, 'parse()?'));
  });
});

describe('a Result that must be used', () => {
  const declarations = [
    'struct Form { name: string }',
    'fn validate(self: Form) -> Result<int>: Result.Ok{1}',
    'fn twice(r: Result<int>) -> (Result<int>, int): (r, 2)',
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
    'struct Inner { zip: int?; code: int }',
    'struct Outer { inner: Inner? }',
    'struct Plain { inner: Inner }',
    'fn f(outer: Outer?, plain: Plain?):',
  ];

  it.each([
    ["'?.' wraps a plain value once", 'const v: int? = outer?.inner?.code'],
    ["'?.' keeps an optional value as it is", 'const v: int? = outer?.inner?.zip'],
    ['a chain carries on through a plain link', 'const v: int? = plain?.inner.code'],
    ["'??' with a plain right side gives the plain type", 'const v: int = outer?.inner?.code ?? 0'],
    [
      "'??' with an optional right side gives an optional",
      'const v: int? = outer?.inner?.zip ?? none',
    ],
  ])('%s', (_case, line) => {
    expect(reported([...chained, `  ${line}`, '  v'].join('\n'))).toEqual(reportedNothing);
  });

  it("refuses '??' giving a plain value where its right side is optional", () => {
    const lines = ['  const fallback: int? = 1', '  const v: int = outer?.inner?.zip ?? fallback'];
    expect(reported([...chained, ...lines, '  v'].join('\n')).codes).toEqual([
      reports.typeMismatch.code,
    ]);
  });

  it.each([
    ['right after the ?.', 'outer?.reset()'],
    ['on a later link', 'plain?.inner.reset()'],
  ])("refuses a '&self' method through a chain, %s", (_case, call) => {
    const lines = ['fn reset(self: &Inner): self.code = 0', ...chained, `  ${call}`];
    expect(reported(lines.join('\n'))).toEqual(reportedOnce(reports.chainNotPlace.code, 'reset'));
  });
});

describe("an Error's trace", () => {
  it('may be left out of an Error only', () => {
    const text = [
      'struct Note { message: string; trace: string }',
      'fn f():',
      '  const e = Error{message: "m", code: "c"}',
      '  const n = Note{message: "m"}',
    ].join('\n');
    expect(reported(text)).toEqual(reportedOnce(reports.missingField.code, 'Note'));
  });
});

function indent(lines: string): string {
  return lines
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
