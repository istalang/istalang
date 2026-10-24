/**
 * Totality and recovery, as properties over random token sequences:
 * - parsing never throws
 * - child spans lie within their parent's and are ordered
 * - every error node comes with a diagnostic
 * - an expression broken on purpose never parses silently
 * - recovery never consumes a closing bracket that belongs to an enclosing construct
 * Plus table cases for recovery inside lists.
 *
 * Token soup alone can't show that every error is reported, since one diagnostic may explain many
 * error nodes. So valid expressions are also broken in ways that are always invalid (a parenthesis
 * dropped, or a token that no expression contains inserted), and each must be reported or left
 * unparsed.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import type { MemberAccess } from '../syntax/expressions.ts';
import { dump, errorNodes, spanViolations } from '../syntax/tree.test-kit.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { operatorTree, printFull } from './expressions/precedence.test-kit.ts';
import { type Category, parenFreeSoup, parseAs, reported, tokenSoup } from './parse.test-kit.ts';

const categories: readonly Category[] = ['expression', 'type', 'pattern', 'statement', 'module'];

describe('totality', () => {
  it.each(categories)('parses any token sequence as a %s into a well-nested tree', (category) => {
    fc.assert(
      fc.property(tokenSoup, (text) => {
        const parsed = parseAs(category, text);
        const unexplainedError =
          errorNodes(parsed.node).length > 0 && parsed.diagnostics.length === 0;
        expect(spanViolations(parsed.node)).toEqual([]);
        expect(unexplainedError).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe('nodes whose first child is missing', () => {
  it.each([
    ['pattern', '( as '],
    ['expression', 'fn( 1): x'],
    ['expression', 'fn( = 1): 1'],
    ['expression', 'fn(a,  1): x'],
  ] as const)('keep the missing child inside them: %s %j', (category, text) => {
    expect(spanViolations(parseAs(category, text).node)).toEqual([]);
  });
});

describe('no silent errors', () => {
  const neverInExpressions = [';', '@', ':', '}', ']', '='];

  const brokenExpression = fc
    .tuple(
      operatorTree.map(printFull),
      fc.nat(),
      fc.constantFrom(...neverInExpressions),
      fc.boolean(),
    )
    .map(([text, position, token, dropParenthesis]) => {
      const parentheses = [...text.matchAll(/[()]/gu)].map((match) => match.index);
      const dropAt = parentheses[position % Math.max(parentheses.length, 1)];
      if (dropParenthesis && dropAt !== undefined) {
        return text.slice(0, dropAt) + text.slice(dropAt + 1);
      }
      const insertAt = position % (text.length + 1);
      return `${text.slice(0, insertAt)} ${token} ${text.slice(insertAt)}`;
    });

  it('reports, or leaves unparsed, a valid expression with one break in it', () => {
    fc.assert(
      fc.property(brokenExpression, (text) => {
        const parsed = parseAs('expression', text);
        expect(parsed.diagnostics.length + parsed.rest).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });
});

describe('recovery stays inside its brackets', () => {
  const wrappers: readonly (readonly [string, string, string])[] = [
    ['call arguments', 'f(', ')'],
    ['an array', 'f([', '])'],
    ['struct literal items', 'f(Pair{', '})'],
    ['a parameter list', 'f(fn(', '): 1)'],
    ['type arguments', 'f(g<', '>(1))'],
  ];

  it.each(wrappers)('closes %s at their own closer, whatever is inside', (_, open, close) => {
    fc.assert(
      fc.property(parenFreeSoup, (soup) => {
        const text = `${open}${soup}${close}.after`;
        const parsed = parseAs('expression', text);
        const root = parsed.node as MemberAccess;
        expect(dump(root.member)).toBe('after');
        expect(root.target.span.end).toBe(text.lastIndexOf(')') + 1);
        expect(parsed.rest).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('stops an unclosed inner list at the enclosing closer', () => {
    const text = 'f([1, 2).x';
    expect(dump(parseAs('expression', text).node)).toBe(
      '(MemberAccess (Call f [] [(ArrayLiteral [1 2])]) x)',
    );
    expect(reported('expression', text)).toEqual(
      reportedOnce(parserDiagnostics.unclosedBracket.code, '['),
    );
  });

  it('skips junk to the next comma and keeps it as an Invalid item', () => {
    expect(dump(parseAs('expression', 'f(a b c, d)').node)).toBe('(Call f [] [a ! d])');
    expect(reported('expression', 'f(a b c, d)')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, 'b'),
    );
  });

  it('skips a whole bracket group inside junk', () => {
    const parsed = parseAs('expression', 'f(a 1 (b, ]) [d], e)');
    expect(dump(parsed.node)).toBe('(Call f [] [a ! e])');
    expect(parsed.rest).toBe(0);
  });

  it('consumes a stray closer that closes nothing', () => {
    const parsed = parseAs('expression', 'f(a ], b)');
    expect(dump(parsed.node)).toBe('(Call f [] [a ! b])');
    expect(parsed.rest).toBe(0);
  });
});
