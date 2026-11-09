/**
 * A `struct{…}` naming no type (structs.ts): built once what is expected of it is known, so of an
 * expected union it builds the one member its fields give, defaults filling the rest.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { mainGives } from '../../../../../stdlib/prelude/prelude.test-kit.ts';
import { reported } from '../../../check.test-kit.ts';

const declarations = 'struct S { a: Int, b: Int = 2 }';

describe('a struct{…} expected as a union', () => {
  it('builds the member its fields give', () => {
    const text = [declarations, 'fn f() -> S | Int: struct{a: 1}', 'async fn main(): 0'].join('\n');
    expect(reported(text)).toEqual(reportedNothing);
    expect(
      mainGives(
        'Int',
        'const s: S | Int = struct{a: 1}\nmatch s:\n  case S{b}: b\n  case _: 0',
        declarations,
      ),
    ).toBe(2);
  });
});
