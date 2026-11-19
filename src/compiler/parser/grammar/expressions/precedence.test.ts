/**
 * The precedence property: random operator trees, printed with full parentheses and with only
 * the parentheses the §10.3 table requires, both parse back to the same tree with no diagnostics.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Expression } from '../../../syntax/expressions/index.ts';
import { parseAs } from '../../parse.test-kit.ts';
import {
  type OperatorTree,
  operatorTree,
  printFull,
  printMinimal,
  shapeOf,
} from './precedence.test-kit.ts';

function parseClean(text: string) {
  const parsed = parseAs('expression', text);
  return {
    shape: shapeOf(parsed.node as Expression),
    problems: [...parsed.diagnostics.map((diagnostic) => diagnostic.message), parsed.rest],
  };
}

describe('precedence', () => {
  it('parses fully parenthesized operator trees back to themselves', () => {
    fc.assert(
      fc.property(operatorTree, (tree) => {
        expect(parseClean(printFull(tree))).toEqual({ shape: tree, problems: [0] });
      }),
    );
  });

  it('reads `x is P < a >> b` as comparisons, not as type arguments on the pattern', () => {
    const tree: OperatorTree = {
      binary: '<',
      left: { isSubject: { atom: 'a' } },
      right: { binary: '>>', left: { atom: 'a' }, right: { atom: 'a' } },
    };
    expect(parseClean(printMinimal(tree))).toEqual({ shape: tree, problems: [0] });
  });

  it('parses minimally parenthesized operator trees back to themselves', () => {
    fc.assert(
      fc.property(operatorTree, (tree) => {
        expect(parseClean(printMinimal(tree))).toEqual({ shape: tree, problems: [0] });
      }),
      { numRuns: 500 },
    );
  });
});
