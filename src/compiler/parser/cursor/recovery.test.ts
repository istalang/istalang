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
import { reportedOnce } from '../../../foundation/diagnostics/diagnostic.test-kit.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import { spanIn } from '../../syntax/tree/positions.ts';
import { dump, errorNodes, spanViolations } from '../../syntax/tree/tree.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { operatorTree, printFull } from '../grammar/expressions/precedence.test-kit.ts';
import {
  block,
  bodyOf,
  type Category,
  declaredField,
  dumpClean,
  dumpOf,
  expressionStatement,
  functionOf,
  int,
  lines,
  moduleOf,
  parenFreeSoup,
  parseAs,
  reported,
  tokenSoup,
} from '../parse.test-kit.ts';

const categories: readonly Category[] = ['expression', 'type', 'pattern', 'statement', 'module'];

describe('totality', () => {
  it.each(categories)('parses any token sequence as a %s into a well-nested tree', (category) => {
    fc.assert(
      fc.property(tokenSoup, (text) => {
        const parsed = parseAs(category, text);
        const unexplainedError =
          errorNodes(parsed, parsed.node).length > 0 && parsed.diagnostics.length === 0;
        expect(spanViolations(parsed, parsed.node)).toEqual([]);
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
    const parsed = parseAs(category, text);
    expect(spanViolations(parsed, parsed.node)).toEqual([]);
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
        expect(dump(parsed, root.member)).toBe('after');
        expect(spanIn(parsed, root.target.span).end).toBe(text.lastIndexOf(')') + 1);
        expect(parsed.rest).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('stops an unclosed inner list at the enclosing closer', () => {
    const text = 'f([1, 2).x';
    expect(dumpOf(parseAs('expression', text))).toBe(
      '(MemberAccess (Call f [] [(ArrayLiteral [1 2])]) x)',
    );
    expect(reported('expression', text)).toEqual(
      reportedOnce(parserDiagnostics.unclosedBracket.code, '['),
    );
  });

  it('skips junk to the next comma and keeps it as an Invalid item', () => {
    expect(dumpOf(parseAs('expression', 'f(a b c, d)'))).toBe('(Call f [] [a ! d])');
    expect(reported('expression', 'f(a b c, d)')).toEqual(
      reportedOnce(parserDiagnostics.expected.code, 'b'),
    );
  });

  it('skips a whole bracket group inside junk', () => {
    const parsed = parseAs('expression', 'f(a 1 (b, ]) [d], e)');
    expect(dumpOf(parsed)).toBe('(Call f [] [a ! e])');
    expect(parsed.rest).toBe(0);
  });

  it('consumes a stray closer that closes nothing', () => {
    const parsed = parseAs('expression', 'f(a ], b)');
    expect(dumpOf(parsed)).toBe('(Call f [] [a ! b])');
    expect(parsed.rest).toBe(0);
  });
});

describe('a bracket never closed', () => {
  const calls = block(
    expressionStatement('(Call g [] [1 2])'),
    expressionStatement('(Call h [] [])'),
  );

  it('ends before the first later line that stands no deeper than its opener’s', () => {
    const parsed = parseAs('module', lines('fn broken(:', '  1', '', 'fn g(): 2', ''));
    expect(dumpOf(parsed)).toContain(functionOf('g', bodyOf('2')));
    expect(parsed.rest).toBe(0);
  });

  it('keeps the deeper lines below its opener, and is reported once', () => {
    const text = lines('fn f():', '  g(1,', '    2', '  h()', '');
    expect(dumpOf(parseAs('module', text))).toBe(moduleOf(functionOf('f', calls)));
    expect(reported('module', text)).toEqual(
      reportedOnce(parserDiagnostics.unclosedBracket.code, '('),
    );
  });

  it.each([
    ['entry braces', lines('struct Broken { a: Int', '', 'fn g(): 2', '')],
    ['block braces', lines('fn broken():', '  const x = {', '', 'fn g(): 2', '')],
    [
      'a bracket closed inside one never closed',
      lines('fn broken(a: f(', '  g(1,', ')', 'fn g(): 2', ''),
    ],
  ])('ends at that line for %s too', (_, text) => {
    const parsed = parseAs('module', text);
    expect(dumpOf(parsed)).toContain(functionOf('g', bodyOf('2')));
    expect(parsed.rest).toBe(0);
  });

  it('ends a region inside it where it ends, whatever closes that region later', () => {
    const text = lines('fn f():', '  h(', '    g(1,', '  2', ')', '');
    expect(dumpOf(parseAs('module', text))).toContain(expressionStatement('2'));
  });

  it('closes the bracket a closer first on its line lines up with, the deeper one left open', () => {
    const text = lines('fn f():', '  h(', '    g(1,', '  )', '');
    expect(dumpOf(parseAs('module', text))).toBe(
      moduleOf(functionOf('f', bodyOf('(Call h [] [(Call g [] [1])])'))),
    );
    expect(reported('module', text)).toEqual(
      reportedOnce(parserDiagnostics.unclosedBracket.code, '('),
    );
  });

  it('lines closers up level by level, each deeper bracket left open in turn', () => {
    const text = lines('fn f():', '  h(', '    g(', '      k(1,', '    )', '  )', '');
    expect(dumpOf(parseAs('module', text))).toBe(
      moduleOf(functionOf('f', bodyOf('(Call h [] [(Call g [] [(Call k [] [1])])])'))),
    );
    expect(reported('module', text)).toEqual(
      reportedOnce(parserDiagnostics.unclosedBracket.code, '('),
    );
  });

  it.each([
    [
      'a group closed around it later',
      lines('fn f():', '  [', '    b(', '      [', '        d(1,', '    ), x', '  ]', ''),
      '(ArrayLiteral [(Call b [] [(ArrayLiteral [(Call d [] [1])])]) x])',
    ],
    [
      'a group re-paired around it',
      lines('fn f():', '  h(', '    g([', '      k(1,', '    )', '  )', ''),
      '(Call h [] [(Call g [] [(ArrayLiteral [(Call k [] [1])])])])',
    ],
    [
      'a group re-paired around one re-paired before',
      lines('fn f():', '  h(', '    [', '      [1,', '    ],', '    g(2,', '  )', ''),
      '(Call h [] [(ArrayLiteral [(ArrayLiteral [1])]) (Call g [] [2])])',
    ],
  ])('ends the brackets left open inside %s at its closer', (_, text, expression) => {
    expect(dumpOf(parseAs('module', text))).toBe(moduleOf(functionOf('f', bodyOf(expression))));
    expect(reported('module', text).codes).toEqual([
      parserDiagnostics.unclosedBracket.code,
      parserDiagnostics.unclosedBracket.code,
    ]);
  });

  it.each([
    [
      'a block',
      lines('fn f(): {', '  g(1,', '    2', '  h()', '}', ''),
      expressionStatement('(Call h [] [])'),
    ],
    [
      'a struct’s fields',
      lines('struct S {', '  a: (Int,', '  b: Int', '}', ''),
      declaredField('b', int),
    ],
  ])('ends at that line inside %s whose braces close later', (_, text, after) => {
    expect(dumpOf(parseAs('module', text))).toContain(after);
    expect(reported('module', text)).toEqual(
      reportedOnce(parserDiagnostics.unclosedBracket.code, '('),
    );
  });

  it('leaves a bracket closed later taking in every line before its closer', () => {
    const text = lines('fn f():', '  g(1,', '2)', '  h()', '');
    expect(dumpClean('module', text)).toBe(moduleOf(functionOf('f', calls)));
  });
});
