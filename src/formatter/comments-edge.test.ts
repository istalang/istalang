/**
 * Acceptance 1–3 on inputs the corpus lacks: a comment right after an opening bracket, alone in
 * empty brackets or an empty block, between an annotation and its item, after a keyword or an
 * operator inside brackets, and a module of nothing but comments. Each must format once and for
 * all, keeping its tree and its comments.
 */

import { describe, expect, it } from 'vitest';
import { dump } from '../compiler/syntax/tree.test-kit.ts';
import { commentTexts, parseText } from './format.test-kit.ts';
import { formatText } from './format.ts';

const inputs = [
  'fn f(): g(# c\n)\n',
  'fn f(): g(\n  # c\n)\n',
  'fn f(): {\n  # c\n}\n',
  'const x = [\n  # c\n]\n',
  'fn f(): foo( # c\n  a, b)\n',
  'struct S { # c\n  a: int }\n',
  'enum E { # c\n  A; B }\n',
  'fn f(): g( # c\n  1, fn(): {\n    a\n    b\n  })\n',
  '# only\n\n# comments\n',
  '@Suite{"s"}\n# comment\nfn f(): 1\n',
  'fn f():\n  @Waypoint{"w"}\n  # comment\n  const x = 1\n  x\n',
  'async fn main(\n  # c\n) -> Future<int>: 1\n',
  'fn f(x: int\n  # c\n) -> int: x\n',
  'const a = [await # c\n  f(x)]\n',
  'const a = [not await\n  # c\n  x]\n',
  'const a = [... # c\n  xs]\n',
  'fn double(x:\n  # c\n  int) -> int: x\n',
  'type F = (async fn(int) ->\n  # c\n  int)\n',
  'const a = [for x in xs:\n  # c\n  x]\n',
];

describe('a comment where the corpus has none', () => {
  it.each(inputs)('%j formats once and for all, keeping tree and comment', (input) => {
    const tree = parseText(input);
    expect(tree.diagnostics).toEqual([]);
    const once = formatText(input) ?? '';
    const reparsed = parseText(once);
    expect(reparsed.diagnostics).toEqual([]);
    expect(dump(reparsed, reparsed.root)).toBe(dump(tree, tree.root));
    expect(commentTexts(reparsed)).toEqual(commentTexts(tree));
    expect(formatText(once)).toBe(once);
  });
});

const unusualPlaces = [
  'fn f(a: # c\n  int): a\n',
  'fn f(a # c\n  : int): a\n',
  'const s = struct {a: # c\n  1, # d\n  b: 2}\n',
];

describe('a comment in an unusual place', () => {
  it.each(unusualPlaces)('%j keeps its comments apart and formats once and for all', (input) => {
    const tree = parseText(input);
    expect(tree.diagnostics).toEqual([]);
    const once = formatText(input) ?? '';
    const reparsed = parseText(once);
    expect(reparsed.diagnostics).toEqual([]);
    expect(dump(reparsed, reparsed.root)).toBe(dump(tree, tree.root));
    expect(commentTexts(reparsed)).toEqual(commentTexts(tree));
    expect(formatText(once)).toBe(once);
  });
});
