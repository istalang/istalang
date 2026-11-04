/**
 * A parameter's `&` (§3.7) read through the parentheses around its type, as the parser reads a
 * grouped type, so the checker adds no error of its own to the parser's.
 */

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
