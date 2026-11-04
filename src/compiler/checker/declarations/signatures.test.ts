import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../parser/diagnostics.ts';
import { reported } from '../check.test-kit.ts';

describe('a parameter written by reference', () => {
  it('stays one in parentheses, where only the parser refuses its &', () => {
    expect(reported('fn bump(n: (&int)):\n  n += 1')).toEqual(
      reportedOnce(parserDiagnostics.misplacedReference.code, '&int'),
    );
  });
});
