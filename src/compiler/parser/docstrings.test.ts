/**
 * Docstrings (§2): first in a declaration's indented body or a module, or on the line below a
 * declaration without one; refused anywhere else.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import type { Module } from '../syntax/declarations/index.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { lines, parseAs, reported } from './parse.test-kit.ts';

const q3 = '"""';
const { misplacedDocstring } = parserDiagnostics;
const sentence = /\.$/u;

/**
 * The docstrings of a module and of its items, by the item's kind; undefined if it reported
 * anything.
 */
function docsOf(text: string): readonly (readonly [string, string | undefined])[] | undefined {
  if (reported('module', text).codes.length > 0) {
    return undefined;
  }
  const module = parseAs('module', text).node as Module;
  return [
    ['Module', module.doc?.value],
    ...module.items.map(
      (item) => [item.kind, 'doc' in item ? item.doc?.value : undefined] as const,
    ),
  ];
}

describe('where a docstring stands', () => {
  it('documents a module from its first line', () => {
    expect(docsOf(lines('# license', `${q3}Purchases.${q3}`, 'const x = 1'))).toEqual([
      ['Module', 'Purchases.'],
      ['VariableDeclaration', undefined],
    ]);
  });

  it.each([
    ['a function', lines('fn f():', `    ${q3}Does f.${q3}`, '    1'), 'FunctionDeclaration'],
    ['a struct', lines('struct P:', `    ${q3}A point.${q3}`, '    x: Int'), 'StructDeclaration'],
    ['an enum', lines('enum C:', `    ${q3}A color.${q3}`, '    Red'), 'EnumDeclaration'],
    [
      'a trait',
      lines('trait T:', `    ${q3}Has f.${q3}`, '    fn f(self: Self) -> Int'),
      'TraitDeclaration',
    ],
  ])('documents %s from the first line of its body', (_, text, kind) => {
    expect(docsOf(text)?.[1]).toEqual([kind, expect.any(String)]);
  });

  it.each([
    ['an extern function', lines('extern fn now() -> Int', `    ${q3}The time.${q3}`)],
    ['an extern struct', lines('extern sendable struct D', `    ${q3}A decimal.${q3}`)],
    ['a struct in braces', lines('struct P { x: Int }', `    ${q3}A point.${q3}`)],
  ])('documents %s from the line below it', (_, text) => {
    expect(docsOf(text)?.[1]?.[1]).toMatch(sentence);
  });

  it("documents a trait's requirement from the line below it", () => {
    const text = lines('trait T:', '    fn f(self: Self) -> Int', `        ${q3}Gives f.${q3}`);
    const [trait] = (parseAs('module', text).node as Module).items;
    expect(reported('module', text)).toEqual(reportedNothing);
    expect(trait?.kind === 'TraitDeclaration' && trait.members[0]).toMatchObject({
      doc: { value: 'Gives f.' },
    });
  });

  it('documents nothing without a docstring, leaving the field out', () => {
    const [item] = (parseAs('module', 'fn f():\n    1').node as Module).items;
    expect(item?.kind).toBe('FunctionDeclaration');
    expect(item !== undefined && 'doc' in item).toBe(false);
  });
});

describe('a docstring anywhere else', () => {
  it.each([
    ['second in a body', lines('fn f():', '    1', `    ${q3}Late.${q3}`)],
    ['in an if', lines('fn f():', '    if x:', `        ${q3}No.${q3}`, '        1')],
    ['as a value', `const x = ${q3}No.${q3}`],
    ['after an import', lines("import * as t from 'time'", `${q3}Late.${q3}`)],
    ['below a variable', lines('const x = 1', `    ${q3}No.${q3}`)],
  ])('is reported %s', (_, text) => {
    expect(reported('module', text)).toEqual(
      reportedOnce(misplacedDocstring.code, expect.any(String)),
    );
  });
});
