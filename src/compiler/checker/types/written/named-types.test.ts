/**
 * Variant names (§3.11): what a module reports of a bare variant no enum is expected of is its
 * own, so what a module it imports declares beside what it imports changes nothing it reports.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';

describe('a bare variant no enum is expected of', () => {
  it('is reported alike whatever enums an imported module declares beside what it imports', () => {
    const main = [
      "import helper from 'other'",
      'enum Verdict { Approved, Rejected(by: String) }',
      'fn f() -> Verdict:',
      '  const g = Rejected("x")',
      '  const n = helper()',
      '  Approved',
    ].join('\n');
    const helper = 'fn helper() -> Int: 1';
    const diagnosticsBeside = (other: string) =>
      diagnosedAt(stdProgramOf({ main, other }), 'main').diagnostics;
    expect(diagnosticsBeside(`enum Decision { Rejected(by: String), Expired }\n${helper}`)).toEqual(
      diagnosticsBeside(helper),
    );
  });
});
