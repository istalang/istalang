import { describe, expect, it } from 'vitest';
import { textOf } from '../../../foundation/text/span.ts';
import { treeOf } from '../language-service.test-kit.ts';
import type { DocumentSymbol } from './symbols.ts';
import { symbolsOf } from './symbols.ts';

/** An outline as names and kinds, members nested. */
function outline(symbols: readonly DocumentSymbol[]): readonly unknown[] {
  return symbols.map(({ name, kind, children }) =>
    children.length === 0 ? [name, kind] : [name, kind, outline(children)],
  );
}

describe('the outline', () => {
  it('names a static function as it is called, and selects its own name', () => {
    const tree = treeOf('struct Pair:', '  first: Int', 'fn Pair.make() -> Pair: Pair{first: 1}');
    const [pair, make] = symbolsOf(tree);
    expect(outline([pair, make].flatMap((symbol) => symbol ?? []))).toEqual([
      ['Pair', 'struct', [['first', 'field']]],
      ['Pair.make', 'function'],
    ]);
    expect(make && textOf(tree.source, make.nameSpan)).toBe('make');
  });

  it('shows each name a destructuring constant binds, and what an import brings in under its module', () => {
    const tree = treeOf(
      "import a, b from 'lib'",
      'import * as m from "lib"',
      'const (x, (y, _)) = (1, (2, 3))',
    );
    expect(outline(symbolsOf(tree))).toEqual([
      [
        'lib',
        'module',
        [
          ['a', 'imported'],
          ['b', 'imported'],
        ],
      ],
      ['lib', 'module', [['m', 'namespace']]],
      ['x', 'constant'],
      ['y', 'constant'],
    ]);
  });

  it("nests a variant's fields under it, and a trait's requirements under the trait", () => {
    const tree = treeOf(
      'enum Shape:',
      '  Circle(radius: Int)',
      '  Empty',
      'trait Sized:',
      '  size: Int',
      '  fn area(self) -> Int',
    );
    expect(outline(symbolsOf(tree))).toEqual([
      [
        'Shape',
        'enum',
        [
          ['Circle', 'variant', [['radius', 'field']]],
          ['Empty', 'variant'],
        ],
      ],
      [
        'Sized',
        'trait',
        [
          ['size', 'field'],
          ['area', 'method'],
        ],
      ],
    ]);
  });

  it('leaves out a declaration whose name the parser did not find', () => {
    expect(outline(symbolsOf(treeOf('struct :', '  a: Int', 'fn f(): 1')))).toEqual([
      ['f', 'function'],
    ]);
  });
});
