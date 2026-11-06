/**
 * Parsing parameter patterns (proposal 5 §5, note 9): struct, tuple, '{…}' shorthand, nested,
 * rest and 'as name' / 'as self' patterns in declared functions and lambdas, default values,
 * and the places where only a plain name is allowed (paren-less lambdas, rest parameters).
 */

import { describe, expect, it } from 'vitest';
import { createSourceText } from '../../../../text/source-text.ts';
import { scan } from '../../../scanner/scan.ts';
import { errorNodes, spanViolations, strayBodies } from '../../../syntax/tree.test-kit.ts';
import { lines, reported } from '../../parse.test-kit.ts';
import { parse } from '../../parse.ts';

function parseProblems(text: string): readonly string[] {
  const source = createSourceText('test.ista', text);
  const tree = parse(source, scan(source));
  return [
    ...tree.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    ...spanViolations(tree, tree.root),
    ...strayBodies(tree),
    ...errorNodes(tree, tree.root).map((node) => `error node ${node.kind}`),
  ];
}

describe('parameter patterns in declared functions and lambdas (§5)', () => {
  it.each([
    ['named struct pattern without type annotation', 'fn norm(Point{x, y}) -> Float: x + y'],
    [
      'generic struct pattern with type arguments',
      'fn swap<A, B>(Pair<A, B>{first, second}) -> Pair<B, A>: Pair{first: second, second: first}',
    ],
    ['qualified struct pattern', 'fn read(geom.Point{x, y}) -> Int: x + y'],
    [
      'pattern with "as self" method receiver and "as name" whole binding',
      lines(
        'fn length(Point{x, y} as self) -> Float: x + y',
        'fn scale(Point{x, y} as pt, factor: Float) -> Float: (x + y) * factor',
      ),
    ],
    [
      'annotated struct{…} and {…} shorthand for struct{…}',
      lines(
        'fn area(struct{w, h}: Rect) -> Int: w * h',
        'fn perimeter({w, h}: Rect) -> Int: 2 * (w + h)',
        'fn withWhole({w, h} as r: Rect) -> Int: w + h',
      ),
    ],
    [
      'tuple pattern and nested patterns with field renames and struct rest',
      lines(
        'fn sum((a, b): (Int, Int)) -> Int: a + b',
        'fn nested(((a, {x as px, ...rest}), _): ((Int, Record), String)) -> Int: a + px',
      ),
    ],
    [
      'destructured parameter with a default value, and later default using its bindings',
      lines(
        'fn configure(Options{retries, region} = Options.default()) -> Int: retries',
        'fn window(Range{start, end}, step: Int = end - start) -> Int: step',
      ),
    ],
    [
      'lambdas with struct{…}, {…}, Point{…}, tuple and nested patterns, untyped and annotated',
      lines(
        'fn run():',
        '  const a = ps.map(fn(struct{x, y}): x + y)',
        '  const b = ps.map(fn({data, ctx}): data + ctx)',
        '  const c = ps.map(fn(Point{x, y} as p): x + y)',
        '  const d = pairs.map(fn((k, v)): `${k}=${v}`)',
        '  const e = pairs.map(fn((k, v): (String, Int)): k)',
        '  const f = fn name({x, y}: Point) -> Int: x + y',
      ),
    ],
    [
      'multi-line parameter list with pattern parameters (Rule 5 + Rule 6)',
      lines(
        'fn combine(',
        '  Point{x, y} as origin',
        '  {dx, dy}: Delta',
        '  (scaleX, scaleY): (Int, Int) = (1, 1)',
        ') -> Int:',
        '  (x + dx) * scaleX + (y + dy) * scaleY',
      ),
    ],
  ])('parses %s cleanly', (_name, text) => {
    expect(parseProblems(text)).toEqual([]);
  });
});

describe('where parameter patterns are refused by the parser (§5)', () => {
  it.each([
    ['paren-less lambda with {…} pattern', 'const f = fn {x, y}: x + y'],
    ['paren-less lambda with struct{…} pattern', 'const f = fn struct{x, y}: x + y'],
    ['rest parameter with tuple pattern', 'fn f(...(a, b): Array<(Int, Int)>): a'],
    ['rest parameter with struct pattern', 'fn f(...Point{x, y}: Array<Point>): x'],
    ['function type with a struct pattern parameter', 'type Handler = fn(Point{x, y}) -> Int'],
  ])('reports a parse error on %s', (_name, text) => {
    expect(reported('module', text).codes.length).toBeGreaterThan(0);
  });
});
