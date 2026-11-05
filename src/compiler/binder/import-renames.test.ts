/**
 * Imported names renamed (§3.13): an alias binds the export it names, and only the alias is in
 * scope, so clashes and the prelude rule read the names bound. Both forms of a named import, bare
 * on one line and parenthesized over any lines, bind alike, and so does what the formatter prints
 * of either: compared as the export each bound name denotes, generated over names and renames.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedNothing, reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { formatText } from '../../formatter/format.ts';
import { idOf } from '../program/program.test-kit.ts';
import { boundReport, declaringName, entityOfName, preludeProgramOf } from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';
import { binderDiagnostics as d } from './diagnostics.ts';

const lib = 'fn a(): 1\nfn b(): 2\nfn c(): 3\nstruct Point { x: Int }\nfn _hidden(): 4\n';

describe('an import renaming a name', () => {
  it('binds the alias to the export, and the export by its own name nowhere', () => {
    const program = preludeProgramOf({
      main: "import a as first, a from 'lib'\nfn f() -> Int: first() + a()",
      lib,
    });
    const declared = (text: string, index: number) =>
      declaringName(entityOfName(program, 'main', text, index));
    expect(declared('first', 1)?.text).toBe('a');
    expect(declared('a', 2)?.text).toBe('a');
    expect(
      boundReport({ main: "import Point as P from 'lib'\nfn f(p: Point) -> P: p", lib }),
    ).toEqual(reportedOnce(d.undeclared.code, 'Point'));
    expect(boundReport({ main: "import a, a as again from 'lib'", lib })).toEqual(reportedNothing);
  });

  it.each([
    ['two aliases alike', "import a as x, b as x from 'lib'", d.duplicateImport, 'x'],
    ['an alias like an import', "import a, b as a from 'lib'", d.duplicateImport, 'a'],
    ['an alias like a declaration', "import a as f from 'lib'\nfn f(): 2", d.importClash, 'f'],
    ['an alias like a prelude type', "import Point as Error from 'lib'", d.preludeClash, 'Error'],
    ['a function renamed as a prelude one', "import a as add from 'lib'", d.preludeClash, 'add'],
    ['a missing export renamed', "import nothing as x from 'lib'", d.missingExport, 'nothing'],
    ['a private export renamed', "import _hidden as h from 'lib'", d.privateExport, '_hidden'],
  ])('reports %s once, at the name', (_, main, rule, name) => {
    expect(boundReport({ main, lib })).toEqual(reportedOnce(rule.code, name));
  });
});

/** One imported name: an export of `lib`, and the alias it is bound as, if renamed. */
interface Imported {
  readonly name: string;
  readonly alias: string | undefined;
}

const importedArbitrary: fc.Arbitrary<readonly Imported[]> = fc
  .uniqueArray(fc.constantFrom('a', 'b', 'c', 'Point'), { minLength: 1, maxLength: 4 })
  .chain((names) =>
    fc.tuple(
      ...names.map((name, index) =>
        fc.record({
          name: fc.constant(name),
          alias: fc.option(fc.constant(name === 'Point' ? `P${index}` : `n${index}`), {
            nil: undefined,
          }),
        }),
      ),
    ),
  );

function spelled({ name, alias }: Imported): string {
  return alias === undefined ? name : `${name} as ${alias}`;
}

/** Every name an import of `importedArbitrary` may bind, renamed or not. */
const bindable = [
  'a',
  'b',
  'c',
  'Point',
  ...[0, 1, 2, 3].flatMap((index) => [`n${index}`, `P${index}`]),
];

/** What each name `main` may bind denotes, as the name declaring it in `lib`. */
function bindingsOf(main: string): ReadonlyMap<string, string | undefined> {
  const bindings = bindProgram(preludeProgramOf({ main, lib }));
  return new Map(
    bindable.map((name) => [name, declaringName(bindings.topLevelNamed(idOf('main'), name))?.text]),
  );
}

describe('both forms of a named import', () => {
  it('bind the names a bare one-line import binds, over any separators and through the formatter', () => {
    const separators = fc.constantFrom(', ', '\n  ', ',\n  ', '\n\n  # note\n  ');
    fc.assert(
      fc.property(
        importedArbitrary,
        fc.array(separators, { minLength: 4, maxLength: 4 }),
        (names, joins) => {
          const bare = `import ${names.map(spelled).join(', ')} from 'lib'\n`;
          const listed = names
            .map((each, index) => (index === 0 ? '' : joins[index - 1]) + spelled(each))
            .join('');
          const parenthesized = `import (\n  ${listed}\n) from 'lib'\n`;
          const expected = bindingsOf(bare);
          expect(boundReport({ main: bare, lib })).toEqual(reportedNothing);
          expect(boundReport({ main: parenthesized, lib })).toEqual(reportedNothing);
          expect(bindingsOf(parenthesized)).toEqual(expected);
          expect(bindingsOf(formatText(bare) ?? '')).toEqual(expected);
          expect(bindingsOf(formatText(parenthesized) ?? '')).toEqual(expected);
        },
      ),
      { numRuns: 60 },
    );
  });
});
