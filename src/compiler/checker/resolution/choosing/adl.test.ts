/**
 * Argument-dependent lookup as a program sees it (§3.13): an operator finds its function in the
 * module declaring an argument's own type, never through a type argument, and otherwise only
 * where the function is imported by name.
 */

import { describe, expect, it } from 'vitest';
import { reportedIn } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { checkerDiagnostics as reports } from '../../diagnostics/index.ts';

/** The codes reported for module `main` of a program of `files`. */
function codesOf(files: Readonly<Record<string, string>>): readonly number[] {
  const { source, diagnostics } = diagnosedAt(stdProgramOf(files), 'main');
  return reportedIn(source, diagnostics).codes;
}

const money = 'struct Money { cents: Int }';
const addMoney = 'fn add(left: Money, right: Money) -> Money: left';
const use = (imports: string, body: string) =>
  `${imports}\nimport * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main():\n  const a = Money{cents: 1}\n  ${body}\n`;

describe('operators on a type declared in another module', () => {
  it("find the function in the type's own module without an import", () => {
    expect(
      codesOf({
        main: use("import Money from 'lib'", 'const b = a + a'),
        lib: `${money}\n${addMoney}`,
      }),
    ).toEqual([]);
  });

  it("don't find a function declared in a third module that isn't imported", () => {
    expect(
      codesOf({
        main: use("import Money from 'lib'", 'const b = a + a'),
        lib: money,
        ops: `import Money from 'lib'\n${addMoney}`,
      }),
    ).toEqual([reports.operatorTypes.code]);
  });

  it('find it once it is imported by name', () => {
    expect(
      codesOf({
        main: use("import Money from 'lib'\nimport add from 'ops'", 'const b = a + a'),
        lib: money,
        ops: `import Money from 'lib'\n${addMoney}`,
      }),
    ).toEqual([]);
  });

  it("don't look in the module of a type argument, only of the argument's own type", () => {
    const text = [
      "import Box from 'box'",
      "import Money from 'lib'\nimport * as runtime from 'runtime'",
      'live async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():',
      '  const a = Box{v: Money{cents: 1}}',
      '  const b = a + a',
    ].join('\n');
    expect(
      codesOf({
        main: text,
        box: 'struct Box<T> { v: T }',
        lib: `import Box from 'box'\n${money}\nfn add(left: Box<Money>, right: Box<Money>) -> Box<Money>: left`,
      }),
    ).toEqual([reports.operatorTypes.code]);
  });
});
