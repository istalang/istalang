/**
 * The rule of dropped variables (§7) over control flow: a use some path reaches from a `drop` is
 * reported once, through branches, short circuits, optional chains, `match` cases, loops and
 * comprehensions carrying a drop to their next pass, `break` and `continue`; assigning a `let` again, a declaration run again and a branch
 * that leaves first make it usable; a lambda uses what it captures where it is made.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../../../diagnostics/diagnostic.test-kit.ts';
import { inFunction, reported } from '../../check.test-kit.ts';
import { checkerDiagnostics as reports } from '../../diagnostics/index.ts';

const lines = (...body: string[]) => body.join('\n');

describe('dropped variables', () => {
  it.each([
    ['assigned again', lines('let t = "a"', 'drop t', 't = "b"', 'const k = t.length()')],
    [
      'dropped on a path that returns',
      lines('const t = "a"', 'if c:', '  drop t', '  return', 'const k = t.length()'),
    ],
    [
      'dropped in another branch',
      lines('const t = "a"', 'if c:', '  drop t', 'else:', '  const k = t.length()'),
    ],
    ['declared again on each pass', lines('for i in 0..2:', '  const t = "a"', '  drop t')],
    [
      'assigned again before the next pass',
      lines('let t = "a"', 'while c:', '  drop t', '  t = "b"'),
    ],
    ['captured before the drop', lines('const t = "a"', 'const f = fn(): t.length()', 'drop t')],
  ])('may be used when %s', (_case, body) => {
    expect(reported(inFunction(body))).toEqual(reportedNothing);
  });

  it.each([
    ['in a later statement', lines('const t = "a"', 'drop t', 'const k = t.length()')],
    ['dropped twice', lines('const t = "a"', 'drop t', 'drop t')],
    ['dropped through parentheses', lines('const t = "a"', 'drop (t)', 'const k = t.length()')],
    [
      'after a branch that may drop',
      lines('const t = "a"', 'if c or n > 0:', '  drop t', 'const k = t.length()'),
    ],
    [
      'after a match case that drops',
      lines(
        'const t = "a"',
        'match n:',
        '  case 0:',
        '    drop t',
        '  case _:',
        '    ()',
        'const k = t.length()',
      ),
    ],
    [
      'after a break carries it out',
      lines('const t = "a"', 'while c:', '  drop t', '  break', 'const k = t.length()'),
    ],
    ['by a lambda made after', lines('const t = "a"', 'drop t', 'const f = fn(): t.length()')],
    [
      'when a `?.` before the assignment may skip it',
      lines(
        'let t = "a"',
        'drop t',
        'const u: String? = none',
        'const k = u?.at({ t = "b"; 0 })',
        'const j = t.length()',
      ),
    ],
  ])('may not be used %s', (_case, body) => {
    expect(reported(inFunction(body))).toEqual(reportedOnce(reports.droppedVariableUsed.code, 't'));
  });

  it.each([
    [
      'early in the next pass',
      lines('const t = "a"', 'while c:', '  const k = t.length()', '  drop t'),
    ],
    [
      'at the top after a continue carries it there',
      lines(
        'let t = "a"',
        'while c:',
        '  const k = t.length()',
        '  if n > 0:',
        '    drop t',
        '    continue',
        '  t = "b"',
      ),
    ],
    [
      "early in a comprehension's next pass",
      lines('const t = "a"', 'const k = [for i in 0..2: { const m = t.length(); drop t; m }]'),
    ],
  ])('may not be used, nor dropped again, %s', (_case, body) => {
    const { codes, spanTexts } = reported(inFunction(body));
    expect(codes).toEqual([reports.droppedVariableUsed.code, reports.droppedVariableUsed.code]);
    expect(spanTexts).toEqual(['t', 't']);
  });
});

describe('the rules over a whole body', () => {
  const dropping = '{ const t = "a"; drop t; t.length() }';
  const unchanged = '{ let t = 1; t }';
  const bodies = (value: string) => [
    ['a function', `fn f() -> Int: ${value}`],
    ['a parameter default', `fn f(a: Int = ${value}) -> Int: a`],
    ['a field default', `struct S { a: Int = ${value} }`],
  ];

  it.each(bodies(dropping))('find a dropped variable used in %s', (_body, text) => {
    expect(reported(text)).toEqual(reportedOnce(reports.droppedVariableUsed.code, 't'));
  });

  it.each(bodies(unchanged))('find a let never reassigned in %s', (_body, text) => {
    expect(reported(text)).toEqual(reportedOnce(reports.letNeverReassigned.code, 't'));
  });
});
