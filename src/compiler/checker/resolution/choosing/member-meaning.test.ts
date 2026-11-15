/**
 * What a name on a receiver may mean (§3.1, §3.7), one answer for a read, a call and what tools
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
});
