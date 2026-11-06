/**
 * A constraint's trait (§3.5, §3.10) read through the parentheses around it, as any grouped type
 * is read.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

describe('a constraint', () => {
  it('names its trait in parentheses', () => {
    const text = 'fn smallest<T is (Comparable)>(a: T, b: T) -> T:\n  if a < b: a else: b';
    expect(reported(text)).toEqual(reportedNothing);
  });
});
