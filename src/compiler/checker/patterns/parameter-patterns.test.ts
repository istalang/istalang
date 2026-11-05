/**
 * Checking and running parameter patterns (proposal 5 §5, notes 9 and 11): declared functions
 * and lambdas taking struct, '{…}' shorthand, tuple, nested, renamed and rest patterns, 'as self'
 * methods, 'as name' for named arguments, defaults using earlier pattern bindings, overload
 * clashes (5105), immutability of pattern bindings (5008/5207), refutable pattern refusals (5203),
 * and the fast-check equivalence property against body-entry destructuring.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { lines } from '../../parser/parse.test-kit.ts';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

describe('parameter patterns in declared functions and lambdas (§5)', () => {
  it('destructures named structs, generic structs, annotated shapes, {…} shorthands and tuples', () => {
    const decls = lines(
      'struct Point { x: Int, y: Int }',
      'struct Pair<A, B> { first: A, second: B }',
      'type Rect = { w: Int, h: Int }',
      'fn sumPoint(Point{x, y}) -> Int: x + y',
      'fn joinPair(Pair<String, Int>{first, second as n}) -> String: `${first}:${n}`',
      'fn area(struct{w, h}: Rect) -> Int: w * h',
      'fn perim({w, h}: Rect) -> Int: 2 * (w + h)',
      'fn tupleSum((a, b): (Int, Int)) -> Int: a + b',
    );
    const body = lines(
      'const p = Point{x: 3, y: 4}',
      'const r: Rect = struct{w: 5, h: 6}',
      '(sumPoint(p), joinPair(Pair{first: "k", second: 9}), area(r), perim(r), tupleSum((7, 8)))',
    );
    expect(mainGives('(Int, String, Int, Int, Int)', body, decls)).toEqual([7, 'k:9', 30, 22, 15]);
  });

  it('destructures nested patterns with field renames, struct rest, and implicit nominal-to-shape conversion', () => {
    const decls = lines(
      'struct Pixel { x: Int, y: Int, z: Int }',
      'fn takeRest({x as px, ...rest}: { x: Int, y: Int, z: Int }) -> Int:',
      '  px * 100 + rest.y * 10 + rest.z',
    );
    expect(mainGives('Int', 'takeRest(Pixel{x: 1, y: 2, z: 3})', decls)).toBe(123);
  });

  it('infers lambda parameter pattern types from the expected function type, including generic structs', () => {
    const decls = lines(
      'struct Point { x: Int, y: Int }',
      'struct Box<T> { value: T, weight: Int }',
    );
    const body = lines(
      'const pts = [Point{x: 1, y: 2}, Point{x: 3, y: 4}]',
      'const sums1 = pts.map(fn(struct{x, y}): x + y)',
      'const sums2 = pts.map(fn({x, y}): x * y)',
      'const sums3 = pts.map(fn(Point{x, y} as p): p.x + y)',
      'const boxes = [Box{value: "a", weight: 10}, Box{value: "b", weight: 20}]',
      'const labels = boxes.map(fn(Box{value, weight}): `${value}:${weight}`)',
      'const pairs = [("x", 1), ("y", 2)]',
      'const formatted = pairs.map(fn((k, v)): `${k}=${v}`)',
      '(sums1, sums2, sums3, labels, formatted)',
    );
    expect(
      mainGives('(Array<Int>, Array<Int>, Array<Int>, Array<String>, Array<String>)', body, decls),
    ).toEqual([
      [3, 7],
      [2, 12],
      [3, 7],
      ['a:10', 'b:20'],
      ['x=1', 'y=2'],
    ]);
  });

  it('supports "as self" methods, "as name" named arguments, and defaults using earlier pattern bindings', () => {
    const decls = lines(
      'struct Point { x: Int, y: Int }',
      'struct Span { start: Int, end: Int }',
      'fn manhattan(Point{x, y} as self) -> Int: self.x + y',
      'fn shift(Point{x, y} as origin, dx: Int = x) -> Int: origin.x + y + dx',
      'fn window(Span{start, end} = Span{start: 2, end: 9}, step: Int = end - start) -> Int:',
      '  start * 100 + end * 10 + step',
    );
    const body = lines(
      'const p = Point{x: 4, y: 5}',
      '(p.manhattan(), manhattan(p), shift(origin: p, dx: 10), shift(p), window(), window(Span{start: 1, end: 4}))',
    );
    expect(mainGives('(Int, Int, Int, Int, Int, Int)', body, decls)).toEqual([
      9, 9, 19, 13, 297, 143,
    ]);
  });

  it("takes a spawned function's argument apart in the instance it starts, from its JSON", () => {
    const decls = lines(
      'struct Point { x: Int, y: Int }',
      'async fn sum(Point{x, y} as p, (a, b): (Int, Int)) -> Future<Int>:',
      '  x * 1000 + y * 100 + p.x * 10 + a + b',
    );
    const body = 'await spawn sum(Point{x: 1, y: 2}, (3, 4)).result()';
    expect(mainGives('Result<Int>', body, decls)).toEqual({ type: 'Ok', value: 1217 });
  });

  it('detects overload clashes between a pattern parameter and a plain parameter of the same type', () => {
    const code = lines(
      'struct Point { x: Int, y: Int }',
      'fn f(Point{x, y}) -> Int: x + y',
      'fn f(p: Point) -> Int: p.x',
    );
    expect(reported(code).codes).toContain(checkerDiagnostics.overloadClash.code);
  });
});

describe('parameter pattern refusals (§5)', () => {
  it('refuses named arguments targeting a destructured parameter that has no "as" name', () => {
    const code = lines(
      'struct Point { x: Int, y: Int }',
      'fn norm(Point{x, y}) -> Int: x + y',
      'fn main():',
      '  _ = norm(x: 1, y: 2)',
    );
    expect(reported(code).codes).toContain(checkerDiagnostics.noParameterNamed.code);
  });

  it('treats names bound by a parameter pattern as immutable consts', () => {
    const code = lines(
      'struct Point { x: Int, y: Int }',
      'fn mutate(Point{x, y}) -> Int:',
      '  x = 10',
      '  x + y',
    );
    expect(reported(code)).toEqual(reportedOnce(checkerDiagnostics.constReassigned.code, 'x'));
  });

  it.each([
    ['enum variant pattern (Ok{value})', lines('fn f(Ok{value}: Result<Int>) -> Int: value')],
    [
      'comparison field pattern (Verdict{ok == false})',
      lines('struct Verdict { ok: Bool }', 'fn f(Verdict{ok == false}) -> Int: 0'),
    ],
    ['literal pattern', 'fn f(0: Int) -> Int: 0'],
    ['alternative pattern', 'fn f((a, 0) | (0, a): (Int, Int)) -> Int: a'],
    ['array pattern', 'fn f([a, b]: Array<Int>) -> Int: a + b'],
    ['range pattern', 'fn f(0..10: Int) -> Int: 0'],
  ])('refuses refutable parameter pattern: %s', (_name, code) => {
    expect(reported(code).codes).toContain(checkerDiagnostics.refutableTarget.code);
  });

  const point = 'struct Point { x: Int, y: Int }';
  const pair = 'struct Pair<A, B> { first: A, second: B }';
  const {
    patternTypeTwice,
    typeArgumentCount,
    parameterTypeMissing,
    patternByReference,
    patternWithoutBody,
    parameterTypeUnknown,
    typeMismatch,
  } = checkerDiagnostics;
  it.each([
    [
      'type annotation beside a pattern that already names its type',
      lines(point, 'fn f(Point{x, y}: Point) -> Int: x + y'),
      patternTypeTwice.code,
      'Point',
    ],
    [
      'generic struct named without type arguments in a declared function',
      lines(pair, 'fn f(Pair{first, second}) -> Int: 0'),
      typeArgumentCount.code,
      'Pair',
    ],
    [
      'unannotated {x, y} without default in a declared function',
      'fn f({x, y}) -> Int: x + y',
      parameterTypeMissing.code,
      '{x, y}',
    ],
    [
      'unannotated tuple pattern without default in a declared function',
      'fn f((a, b)) -> Int: a + b',
      parameterTypeMissing.code,
      '(a, b)',
    ],
    [
      'unannotated name without default in a declared function',
      'fn f(x) -> Int: 1',
      parameterTypeMissing.code,
      'x',
    ],
    [
      'reference "&" parameter with a struct pattern',
      lines(point, 'fn f({x, y}: &Point): ()'),
      patternByReference.code,
      '{x, y}',
    ],
    [
      'reference "&" parameter with a tuple pattern',
      'fn f((a, b): &(Int, Int)): ()',
      patternByReference.code,
      '(a, b)',
    ],
    [
      'extern function with a pattern parameter',
      lines(point, 'extern fn f(Point{x, y}) -> Int'),
      patternWithoutBody.code,
      'Point{x, y}',
    ],
    [
      'trait requirement with a pattern parameter',
      lines(point, 'trait T:', '  fn f(self: Self, Point{x, y}) -> Int'),
      patternWithoutBody.code,
      'Point{x, y}',
    ],
    [
      'lambda pattern with no type, written or expected',
      lines('fn main() -> Int:', '  const f = fn({x, y}): x', '  0'),
      parameterTypeUnknown.code,
      '{x, y}',
    ],
    [
      "lambda pattern whose written type arguments differ from the expected function type's",
      lines(
        pair,
        'fn g(f: fn(Pair<Int, String>) -> Int) -> Int: 0',
        'fn main() -> Int: g(fn(Pair<Int, Bool>{first, second}): first)',
      ),
      typeMismatch.code,
      'fn(Pair<Int, Bool>{first, second}): first',
    ],
    [
      'lambda pattern naming its type and annotated with it too',
      lines(
        point,
        'fn main() -> Int:',
        '  const f = fn(Point{x, y}: Point): x',
        '  f(Point{x: 1, y: 2})',
      ),
      patternTypeTwice.code,
      'Point',
    ],
    [
      "lambda pattern at a '&' slot of the expected function type",
      lines(
        point,
        'fn apply(cb: fn(&Point) -> Int, p: &Point) -> Int: cb(&p)',
        'fn main() -> Int:',
        '  let p = Point{x: 1, y: 2}',
        '  apply(fn({x, y}): x + y, &p)',
      ),
      patternByReference.code,
      '{x, y}',
    ],
  ])('refuses invalid parameter pattern: %s', (_name, code, expected, at) => {
    expect(reported(code)).toEqual(reportedOnce(expected, at));
  });
});

describe('a pattern naming its type types its parameter, as an annotation does (§5)', () => {
  const shapes = lines(
    'struct Point { x: Float, y: Float }',
    'struct Rect { w: Float, h: Float }',
    'fn apply(f: fn(Point) -> Float) -> Float: f(Point{x: 1.0, y: 2.0})',
    'fn apply(f: fn(Rect) -> Float) -> Float: f(Rect{w: 3.0, h: 4.0})',
    'fn applyOnly<T>(f: fn(T) -> Float, value: T) -> Float: f(value)',
  );

  it("chooses an overload and infers a type argument by a lambda's pattern-named type", () => {
    const body =
      '(apply(fn(Point{x, y}): x + y), applyOnly(fn(Rect{w, h}): w * h, Rect{w: 2.0, h: 5.0}))';
    expect(mainGives('(Float, Float)', body, shapes)).toEqual([3, 10]);
  });

  it('reads a default of a parameter whose pattern names its type as one of an annotated parameter', () => {
    const calling = (parameter: string) =>
      lines(
        'struct Point { x: Int, y: Int }',
        `fn f(${parameter} = f(Point{x: 0, y: 0})) -> Point: Point{x: 1, y: 2}`,
      );
    expect(reported(calling('Point{x, y}'))).toEqual(reported(calling('p: Point')));
  });
});

describe('equivalence property: parameter pattern vs body destructuring (§5, note 11)', () => {
  interface PatternCase {
    readonly type: string;
    readonly paramPattern: string;
    readonly constPattern: string;
    readonly value: string;
    readonly expr: string;
  }

  const patternCases: fc.Arbitrary<PatternCase> = fc
    .tuple(
      fc.integer({ min: -50, max: 50 }),
      fc.integer({ min: -50, max: 50 }),
      fc.integer({ min: -50, max: 50 }),
      fc.boolean(),
    )
    .map(([a, b, c, useWhole]): PatternCase => {
      const basePattern = '(first, {x as px, ...rest})';
      const paramPattern = useWhole
        ? `${basePattern} as whole: (Int, { x: Int, y: Int, z: Int })`
        : `${basePattern}: (Int, { x: Int, y: Int, z: Int })`;
      // `{…}` is short for `struct{…}` in a parameter only (§3.3); a declaration writes it out.
      const constBase = '(first, struct{x as px, ...rest})';
      const constPattern = useWhole ? `${constBase} as whole` : constBase;
      const expr = useWhole
        ? 'first + px * 10 + rest.y * 100 + rest.z * 1000 + whole.0'
        : 'first + px * 10 + rest.y * 100 + rest.z * 1000';
      return {
        type: '(Int, { x: Int, y: Int, z: Int })',
        paramPattern,
        constPattern,
        value: `(${a}, struct{x: ${b}, y: ${c}, z: ${a + b}})`,
        expr,
      };
    });

  it('runs a function taking a parameter pattern to the exact same value as one destructuring in its first line', () => {
    fc.assert(
      fc.property(patternCases, (testCase) => {
        const decls = lines(
          `fn byParam(${testCase.paramPattern}) -> Int:`,
          `  ${testCase.expr}`,
          `fn byConst(arg: ${testCase.type}) -> Int:`,
          `  const ${testCase.constPattern} = arg`,
          `  ${testCase.expr}`,
        );
        const body = `byParam(${testCase.value}) == byConst(${testCase.value})`;
        expect(mainGives('Bool', body, decls)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});
