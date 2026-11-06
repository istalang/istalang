/**
 * The language service over parameter patterns (proposal 5 §5, note 9): hover prints a pattern
 * as written and binds its names in the body, navigation reaches a name a pattern binds, and
 * signature help prints the pattern and marks the parameter after it.
 */

import { describe, expect, it } from 'vitest';
import { completionsAt } from './completion/index.ts';
import { hoverAt } from './hover.ts';
import { programAt } from './language-service.test-kit.ts';
import { nameAt } from './navigation/declarations.ts';
import { referencesAt } from './navigation/references.ts';
import { renameEdits } from './navigation/rename.ts';
import { signatureHelpAt } from './signatures/signature-help.ts';

function completed(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

function hover(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  return hoverAt(program, module, offset);
}

describe('hover on parameter patterns (note 9)', () => {
  it('shows parameter patterns in function hover signatures and binds their names in the body', () => {
    const decls = [
      'struct Point { x: Int, y: Int }',
      'fn norm(Point{x, y}) -> Int: x + y',
      'fn length(Point{x, y} as self) -> Int: self.x + y',
    ];
    expect(hover(...decls, 'fn main() -> Int: no‸rm(Point{x: 1, y: 2})')?.code).toEqual([
      'fn norm(Point{x, y}) -> Int',
    ]);
    expect(hover(...decls, 'fn main(p: Point) -> Int: p.len‸gth()')?.code).toEqual([
      'fn length(Point{x, y} as self) -> Int',
    ]);
    expect(
      hover('struct Point { x: Int, y: Int }', 'fn norm(Point{x, y}) -> Int: ‸x + y')?.code,
    ).toEqual(['(variable) x: Int']);
  });
});

describe('hover on the parts a parameter pattern takes (note 9)', () => {
  it("shows a field shorthand's field and the part's own type, not the whole parameter's", () => {
    const point = 'struct Point { x: Float, y: Float }';
    expect(hover(point, 'fn norm(Point{‸x, y}) -> Float: x + y')?.code).toEqual([
      '(field) x: Float',
      '(variable) x: Float',
    ]);
    expect(hover(point, 'fn norm(Point{‸x as a, y}) -> Float: a + y')?.code).toEqual([
      '(field) x: Float',
    ]);
    expect(hover('fn sum((‸a, b): (Int, String)) -> Int: a')?.code).toEqual(['(variable) a: Int']);
  });
});

describe('completion inside parameter patterns (note 9)', () => {
  const point = 'struct Point { x: Int, y: Int }';

  it("offers the fields a pattern hasn't named, in declared functions and lambdas", () => {
    expect(completed(point, 'fn f(Point{x, ‸}) -> Int: x')).toEqual(['y']);
    expect(completed(point, 'fn f({x, ‸}: Point) -> Int: x')).toEqual(['y']);
    expect(completed(point, 'fn f(ps: Array<Point>) -> Array<Int>: ps.map(fn({x, ‸}): x)')).toEqual(
      ['y'],
    );
  });

  it('offers nothing where a pattern declares a new name', () => {
    expect(completed('fn f((a, ‸): (Int, Int)) -> Int: a')).toEqual([]);
  });
});

describe('navigation on parameter patterns (note 9)', () => {
  it("reaches a field's shorthand in a parameter pattern from the field, for references and rename", () => {
    const { program, module, offset } = programAt(
      'struct Point { ‸x: Int, y: Int }',
      'fn norm(Point{x, y}) -> Int: x + y',
      'fn other(p: Point) -> Int: p.x',
    );
    expect(referencesAt(program, module, offset)).toHaveLength(3);
    const renamed = renameEdits(program, module, offset, 'across');
    expect(renamed?.kind === 'renamed' ? renamed.edits.length : renamed).toBe(3);
  });

  it('navigates from a variable used in a body to its binding inside a parameter pattern', () => {
    const { program, module, offset } = programAt(
      'struct Point { x: Int, y: Int }',
      'fn norm(Point{x, y as py}) -> Int: x + p‸y',
    );
    const found = nameAt(program, module, offset);
    expect(found?.declarations).toHaveLength(1);
    expect(referencesAt(program, module, offset)).toHaveLength(2);
  });
});

describe('signature help on parameter patterns (note 9)', () => {
  it('shows parameter patterns in signature help and marks the active parameter', () => {
    const { program, module, offset } = programAt(
      'struct Point { x: Int, y: Int }',
      'fn move(Point{x, y} as origin, dx: Int) -> Int: x + y + dx',
      'fn main(p: Point) -> Int: move(p, ‸)',
    );
    const help = signatureHelpAt(program, module, offset);
    expect(help?.signatures[0]?.label).toBe('fn move(Point{x, y} as origin, dx: Int) -> Int');
    expect(help?.signatures[0]?.activeParameter).toBe(1);
  });
});
