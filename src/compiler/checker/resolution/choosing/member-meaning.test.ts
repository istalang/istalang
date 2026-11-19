/**
 * What a name on a receiver may mean (§5.2, §6.2), one answer for a read, a call and what tools
 * list: a method counts only where its `self` takes the receiver.
 */

import { describe, expect, it } from 'vitest';
import { inFunction, reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

describe('a member no method of the name takes the receiver of', () => {
  it('is no field to read, and no member to call (B22)', () => {
    expect(
      reported(inFunction('const a = n.filter\nconst b = n.filter(fn(m: Int) -> Bool: true)')),
    ).toEqual({
      codes: [checkerDiagnostics.unknownField.code, checkerDiagnostics.noMember.code],
      spanTexts: ['filter', 'filter'],
    });
  });

  it("reports a method taking the receiver read as a value, and no clash with another type's method", () => {
    const text = [
      'struct Holder:',
      '  filter: fn(Int) -> Bool',
      'fn run(h: Holder, xs: Array<Int>) -> Bool:',
      '  const f = xs.filter',
      '  h.filter(1)',
    ].join('\n');
    expect(reported(text)).toEqual({
      codes: [checkerDiagnostics.methodValue.code],
      spanTexts: ['filter'],
    });
  });
});
