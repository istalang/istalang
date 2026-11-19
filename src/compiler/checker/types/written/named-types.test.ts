/**
 * Variant names (§5.3): what a module reports of a bare variant no enum is expected of is its
 * own, so what a module it imports declares beside what it imports changes nothing it reports, and
 * a revision adding such an enum there checks none of its bodies again.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { idOf } from '../../../program/program.test-kit.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { checkedApart } from '../../check.test-kit.ts';

const main = [
  "import helper from 'other'",
  'enum Verdict { Approved, Rejected(by: String) }',
  'fn f() -> Verdict:',
  '  const g = Rejected("x")',
  '  const n = helper()',
  '  Approved',
].join('\n');
const helper = 'fn helper() -> Int: 1';
const withEnum = `enum Decision { Rejected(by: String), Expired }\n${helper}`;

describe('a bare variant no enum is expected of', () => {
  it('is reported alike whatever enums an imported module declares beside what it imports', () => {
    const diagnosticsBeside = (other: string) =>
      diagnosedAt(stdProgramOf({ main, other }), 'main').diagnostics;
    expect(diagnosticsBeside(withEnum)).toEqual(diagnosticsBeside(helper));
  });

  it("is checked again by no revision adding such an enum to a module it doesn't name it from", () => {
    const before = stdProgramOf({ main, other: helper });
    const first = checkedApart(before);
    first.diagnosticsOf(idOf('main'));
    const checked: string[] = [];
    const second = checkedApart(stdProgramOf({ main, other: withEnum }, before), {
      previous: first,
      observe: (table, key) => {
        if (table === 'bodies') {
          checked.push((key as FunctionDeclaration).name.text);
        }
      },
    });
    second.diagnosticsOf(idOf('main'));
    expect(checked).not.toContain('f');
  });
});
