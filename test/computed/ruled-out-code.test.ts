/**
 * Code a pass rules out (spec §4 field loops, §4 `if` and `match`): a loop over a struct with no
 * fields still checks its body once, as code that never runs, its key and value of a type nothing
 * can be wrong about, so a mistake that doesn't depend on a field is still found, and nothing runs.
 */

import { describe, expect, it } from 'vitest';
import { codesOf, runMain } from './computed.test-kit.ts';

describe('a loop over a struct with no fields', () => {
  it('checks its body once, so a mistake independent of the field is reported', () => {
    expect(
      codesOf(
        'struct Empty',
        'fn f(e: Empty) -> Int:',
        '  for k, v in ...e:',
        '    missing(1)',
        '  0',
      ),
    ).toEqual([5103]);
    expect(
      codesOf(
        'struct Empty',
        'fn f(e: Empty) -> Int:',
        '  const total = 0',
        '  for _, v in ...e:',
        '    total = v',
        '  total',
      ),
    ).toEqual([5008]);
    expect(
      codesOf(
        'struct Empty',
        'fn twice(n: Int) -> Int: n * 2',
        'fn f(e: Empty) -> Array<Int>:',
        '  [for k, _ in ...e: twice("k")]',
      ),
    ).toContain(5002);
  });

  it('accepts a body that fits any field, reads members of its value, and runs nothing', () => {
    const declarations = ['struct Empty', 'trait Named:', '  fn name(self: Self) -> String'];
    const lines = [
      'let seen: Array<String> = []',
      'for k, v in ...Empty:',
      '  seen.push(`${k}:${v.name()}:${v.label}`)',
      'const keys = [for k, v in ...Empty: `${k}${v.size()}`]',
      'const copy: {} = struct{for k, v in ...Empty: [k]: v.inner}',
      '`${seen.length()}|${keys.length()}`',
    ];
    expect(codesOf(...declarations, 'fn f() -> ():', `  ${lines.join('\n  ')}`, '  ()')).toEqual(
      [],
    );
    expect(runMain('String', lines.join('\n  '), declarations)).toBe('0|0');
  });
});
