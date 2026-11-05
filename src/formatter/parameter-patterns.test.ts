/**
 * Formatting parameter patterns (proposal 5 §5): printed as written, and reparsing to the tree
 * printed. Split out of item-breaks.test.ts, which Rule 6 restored, for the Rule 5 fork.
 */

import { describe, expect, it } from 'vitest';
import { dump } from '../compiler/syntax/tree.test-kit.ts';
import { commentTexts, parseText } from './format.test-kit.ts';
import { formatText, formatTree } from './format.ts';

const lines = (...text: readonly string[]): string => `${text.join('\n')}\n`;

function roundTripOf(text: string) {
  const tree = parseText(text);
  const formatted = formatTree(tree) ?? '';
  const reparsed = parseText(formatted);
  return {
    actual: {
      diagnostics: reparsed.diagnostics,
      tree: dump(reparsed, reparsed.root),
      comments: commentTexts(reparsed),
    },
    expected: { diagnostics: [], tree: dump(tree, tree.root), comments: commentTexts(tree) },
  };
}

describe('parameter patterns (§5)', () => {
  it('prints parameter patterns as written', () => {
    const text = lines(
      'fn norm(Point{x, y}) -> Float: x + y',
      'fn length(Point{x, y} as self) -> Float: x + y',
      'fn area(struct{w, h}: Rect) -> Int: w * h',
      'fn perim({w, h}: Rect) -> Int: 2 * (w + h)',
      'fn sum((a, b): (Int, Int)) -> Int: a + b',
      'fn run():',
      '  const xs = ps.map(fn({data, ctx}): data + ctx)',
      '  xs',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });
});
