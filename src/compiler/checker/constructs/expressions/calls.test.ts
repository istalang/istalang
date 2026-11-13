/**
 * What a call's callee may name (§3.7, §3.10): a trait names no type, so nothing converts into it,
 * and calling one is refused, whether written as a call or as the taker of a deferred call (§3.14).
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

describe('a call naming a trait', () => {
  it.each([
    ['written', 'fn f(): _ = Stringable(fn(): x())'],
    ['given a call to run later', 'fn f(): _ = Stringable x()'],
  ])('is refused, %s', (_case, call) => {
    const text = ['fn x() -> Int: 1', call].join('\n');
    expect(reported(text)).toEqual(reportedOnce(checkerDiagnostics.notCallable.code, 'Stringable'));
  });
});
