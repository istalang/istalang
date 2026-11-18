/**
 * Compressed forms (layout/compact.ts): what may stand on one line, through braces or a body on
 * its header's line, does so only when the whole line keeps within 66 columns; a struct value
 * switches between braces and its indented form by the same width (expressions/struct-values.ts);
 * and a lambda's one bare parameter goes without parentheses. Code formatted narrower, as a
 * hover's, keeps its compressed forms within two thirds of its own width.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lines, roundTripOf } from './format.test-kit.ts';
import { formatText, formatTextWithin } from './format.ts';

/** A name `length` characters long, to push a line past a width. */
const named = (length: number): string => 'n'.repeat(length);

describe('a compressed form', () => {
  it('stands on one line up to 66 columns, and breaks past them', () => {
    const fits = `fn f(): ${named(58)}`;
    const over = `fn f(): ${named(59)}`;
    expect(fits).toHaveLength(66);
    expect(formatText(lines(fits))).toBe(lines(fits));
    expect(formatText(lines(over))).toBe(lines('fn f():', `  ${named(59)}`));
  });

  it('puts an if chain, a loop and a case on one line when it fits', () => {
    const text = lines(
      'fn f(c: Bool, xs: Array<Int>, v: Int) -> Int:',
      '  if c: print(1) else: print(2)',
      '  for x in xs: print(x)',
      '  while c: print(0)',
      '  match v:',
      '    case 1: 10',
      '    case _: 0',
    );
    expect(formatText(text)).toBe(text);
    expect(
      formatText(lines('fn f(c: Bool):', '  if c:', '    print(1)', '  else:', '    print(2)')),
    ).toBe(lines('fn f(c: Bool):', '  if c: print(1) else: print(2)'));
  });

  it('reserves its narrower width once per line, however deeply nested', () => {
    const text = lines(
      'fn g(c: Bool) -> Point:',
      '  if c: Point{x: 1, y: 2} else: Point{x: 3, y: 4}',
    );
    expect(formatText(text)).toBe(text);
  });

  it('prints struct, enum and trait declarations in braces when they fit, else indented', () => {
    expect(formatText('struct Req { id: Int, data: struct { v: Int } }\n')).toBe(
      lines('struct Req { id: Int, data: { v: Int } }'),
    );
    expect(
      formatText('struct Request { identifier: Int, payload: struct { value: Int, more: Int } }\n'),
    ).toBe(lines('struct Request:', '  identifier: Int', '  payload: { value: Int, more: Int }'));
    expect(formatText(lines('enum Color:', '  Red', '  Green'))).toBe(
      lines('enum Color { Red, Green }'),
    );
    expect(formatText(lines('trait Named:', '  fn name(self) -> String'))).toBe(
      lines('trait Named { fn name(self) -> String }'),
    );
  });

  it('keeps members indented with a comment, a docstring or a blank line among them', () => {
    const text = lines(
      'struct Commented:',
      '  a: Int # why',
      '',
      'struct Documented:',
      '  """What it holds."""',
      '  a: Int',
      '',
      'struct Grouped:',
      '  a: Int',
      '',
      '  b: Int',
    );
    expect(formatText(text)).toBe(text);
  });
});

describe('a declaration printed on several lines', () => {
  it('has a blank line after it, a one-line one none, and the module ends in one line break', () => {
    const text = lines(
      'struct Short { x: Int }',
      'fn one(): 1',
      'fn two():',
      '  print(1)',
      '  print(2)',
      'trait Named { fn name(self) -> String }',
      'fn last():',
      '  print(1)',
      '  print(2)',
    );
    expect(formatText(text)).toBe(
      lines(
        'struct Short { x: Int }',
        'fn one(): 1',
        'fn two():',
        '  print(1)',
        '  print(2)',
        '',
        'trait Named { fn name(self) -> String }',
        'fn last():',
        '  print(1)',
        '  print(2)',
      ),
    );
  });
});

describe('a struct value', () => {
  it('moves a body below its header whole, rather than hugging the header', () => {
    expect(formatText(lines(`fn make() -> Point: Point{x: ${named(30)}, y: ${named(30)}}`))).toBe(
      lines('fn make() -> Point:', '  Point{', `    x: ${named(30)}`, `    y: ${named(30)}`, '  }'),
    );
  });

  it('switches between braces and its indented form where an indented value may open', () => {
    expect(formatText(lines('const p = Point:', '  x: 1', '  y: 2'))).toBe(
      lines('const p = Point{x: 1, y: 2}'),
    );
    expect(formatText(lines(`const p = Point{x: ${named(30)}, y: ${named(30)}}`))).toBe(
      lines('const p = Point:', `  x: ${named(30)}`, `  y: ${named(30)}`),
    );
    expect(formatText(lines(`const p = struct{x: ${named(30)}, y: ${named(30)}}`))).toBe(
      lines('const p =', `  x: ${named(30)}`, `  y: ${named(30)}`),
    );
  });

  it('keeps its braces where no indented value opens, and its single unnamed field', () => {
    const call = lines('fn f():', `  g(Point{x: ${named(30)}, y: ${named(30)}})`);
    expect(formatText(call)).toBe(
      lines(
        'fn f():',
        '  g(',
        '    Point{',
        `      x: ${named(30)}`,
        `      y: ${named(30)}`,
        '    }',
        '  )',
      ),
    );
    const unnamed = lines(`const id = UserId{"${named(70)}"}`);
    expect(formatText(unnamed)).toBe(lines('const id = UserId{', `  "${named(70)}"`, '}'));
  });

  const values = fc.record({
    form: fc.constantFrom('braces', 'indented'),
    width: fc.integer({ min: 1, max: 40 }),
    count: fc.integer({ min: 1, max: 4 }),
  });

  it('keeps what it builds and formats once and for all, written in either form', () => {
    fc.assert(
      fc.property(values, ({ form, width, count }) => {
        const fields = Array.from({ length: count }, (_, index) => `f${index}: ${named(width)}`);
        const text =
          form === 'braces'
            ? lines(`const v = S{${fields.join(', ')}}`)
            : lines('const v = S:', ...fields.map((field) => `  ${field}`));
        const { actual, expected } = roundTripOf(text);
        expect(actual).toEqual(expected);
      }),
    );
  });
});

describe('a lambda', () => {
  it('writes one bare untyped parameter without parentheses', () => {
    expect(formatText(lines('const f = fn(x): x + 1', 'const g = async fn(x) -> Int: x'))).toBe(
      lines('const f = fn x: x + 1', 'const g = async fn x -> Int: x'),
    );
    const kept = lines('const h = fn(x: Int): x', 'const k = fn(x, y): x', 'const m = fn(): 1');
    expect(formatText(kept)).toBe(kept);
  });
});

describe('code formatted narrower', () => {
  it('keeps its lines within its width, and a compressed form within two thirds of it', () => {
    const fits = `fn f(): ${named(45)}`;
    const over = `fn f(): ${named(46)}`;
    expect(fits).toHaveLength(53);
    expect(formatTextWithin(lines(fits), 80)).toBe(lines(fits));
    expect(formatTextWithin(lines(over), 80)).toBe(lines('fn f():', `  ${named(46)}`));
    const parameters = Array.from({ length: 6 }, (_, index) => `p${index}: ${named(8)}`);
    const header = `fn g(${parameters.join(', ')}) -> Int`;
    expect(formatTextWithin(lines(`${header}: 1`), 80)).toBe(
      lines('fn g(', ...parameters.map((each) => `  ${each}`), ') -> Int:', '  1'),
    );
  });
});
