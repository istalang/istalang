/**
 * What a checker made after an edit analyses again (lifetimes.ts): a caller reads what its callee
 * does through the callee's summary alone, so an edit inside a callee's body that leaves its
 * summary alike analyses the callee again and none of its callers, the closures they make
 * included, and finds what a checker made afresh does.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import { checkedApart } from '../../check.test-kit.ts';

const main = idOf('main.ista');

/** A module whose `suite` makes closures calling `helper`, whose body is `body`. */
function textOf(body: string): string {
  return [
    'fn helper(n: Int) -> Int:',
    `  ${body}`,
    'fn suite() -> Array<fn() -> Int>: [',
    '  fn(): helper(1)',
    '  fn(): helper(2)',
    ']',
    'fn caller() -> Int: helper(3)',
    '',
  ].join('\n');
}

describe('after an edit inside a callee', () => {
  it('analyses the callee again and none of its callers', () => {
    const first = stdProgramOf({ 'main.ista': textOf('n + 1') });
    const second = stdProgramOf({ 'main.ista': textOf('n + n') }, first);
    const previous = checkedApart(first);
    previous.diagnosticsOf(main);
    const analysed: unknown[] = [];
    const checker = checkedApart(second, {
      previous,
      observe: (table, key) => {
        if (table === 'lifetime analyses') {
          analysed.push(key);
        }
      },
    });
    const diagnostics = checker.diagnosticsOf(main);
    expect(analysed.map((key) => (key as { name: { text: string } }).name.text)).toEqual([
      'helper',
    ]);
    expect(diagnostics).toEqual(checkedApart(second).diagnosticsOf(main));
  });
});
