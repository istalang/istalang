import { describe, expect, it } from 'vitest';
import { foldingRangesOf } from './folding.ts';
import { treeOf } from './language-service.test-kit.ts';

describe('folding', () => {
  it('folds an indented block from the line its colon stands on, past comments before it', () => {
    const tree = treeOf('fn f(', '  a: int,', ') -> int:', '  # first', '  const b = a', '  b');
    expect(foldingRangesOf(tree)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 5 },
    ]);
  });

  it("folds a function's block from its header past a docstring, and brackets in a template", () => {
    const tree = treeOf('fn f():', '  """Says hi."""', '  `hi ${g(', '    1,', '  )}`');
    expect(foldingRangesOf(tree)).toEqual([
      { start: 0, end: 4 },
      { start: 2, end: 4 },
    ]);
  });

  it('folds a declaration from the line naming it, below its annotations', () => {
    const tree = treeOf('@Note{"x"}', 'struct Pair:', '  first: int', '  second: int');
    expect(foldingRangesOf(tree)).toEqual([{ start: 1, end: 3 }]);
  });

  it('keeps the longer of two folds starting on one line, and folds no unclosed bracket', () => {
    const tree = treeOf('const x = f(fn():', '  1', ')', 'const y = [', '  1,');
    expect(foldingRangesOf(tree)).toEqual([{ start: 0, end: 2 }]);
  });

  it('folds a bracket around an unclosed one of another kind, as the parser closes it', () => {
    const tree = treeOf('const x = f(', '  a[0,', '  2,', ')');
    expect(foldingRangesOf(tree)).toEqual([{ start: 0, end: 3 }]);
  });
});
