/**
 * The formatter over every corpus file and spec example (formatter.md, Acceptance 1–4, 6), and the
 * style decisions those inputs don't pin down, each on a small module.
 */

import { describe, expect, it } from 'vitest';
import { dump } from '../compiler/syntax/tree.test-kit.ts';
import {
  commentTexts,
  formattableInputs,
  parseText,
  unexplainedLongLines,
} from './format.test-kit.ts';
import { formatText, formatTree } from './format.ts';

const lines = (...text: readonly string[]): string => `${text.join('\n')}\n`;

describe('formatting every corpus file and spec example', () => {
  it.each(formattableInputs)(
    '$name keeps its tree and comments, and formats once and for all within the width',
    ({ text }) => {
      const tree = parseText(text);
      const formatted = formatTree(tree) ?? '';
      const reparsed = parseText(formatted);
      expect(reparsed.diagnostics).toEqual([]);
      expect(dump(reparsed, reparsed.root)).toBe(dump(tree, tree.root));
      expect(commentTexts(reparsed)).toEqual(commentTexts(tree));
      expect(formatTree(reparsed)).toBe(formatted);
      expect(unexplainedLongLines(reparsed)).toEqual([]);
    },
  );
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
          'fn f(a: int) -> int:',
          '        return a',
          `fn g(): call(${long}, ${long}, ${long})`,
        ),
      ),
    ).toBe(
      lines(
        'fn f(a: int) -> int: return a',
        'fn g():',
        '  call(',
        `    ${long},`,
        `    ${long},`,
        `    ${long},`,
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
    expect(formatText('struct Req { id: int; data: struct { v: int } }\n')).toBe(
      lines('struct Req:', '  id: int', '  data: { v: int }'),
    );
  });

  it('keeps one blank line where the source had any between items', () => {
    expect(formatText(lines('const a = 1', '', '', '', 'const b = 2', 'const c = 3'))).toBe(
      lines('const a = 1', '', 'const b = 2', 'const c = 3'),
    );
  });

  it('keeps a comment after a header on its line, and one ending a body in that body', () => {
    const text = lines(
      'fn f(a: int): # about f',
      '  g(a)',
      '  # still in f',
      '',
      'fn g(b: int): b',
    );
    expect(formatText(text)).toBe(text);
  });

  it('keeps a comment closing a list of members or cases in that list, after its comments', () => {
    const text = lines(
      'struct S:',
      '  a: int # on a',
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
      '  }),',
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
      'fn f(a: bool) -> int:',
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
        '    ),',
        '  )',
      ),
    );
  });
});
