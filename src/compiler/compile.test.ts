/**
 * The coordinator's results: diagnostics from every phase so far, merged per module, keyed by the
 * module's id, and derived once per program. That a Definition never shows the numbers types are
 * keyed by is compile.sweep.test.ts's.
 */

import { describe, expect, it } from 'vitest';
import { invalidPrograms } from '../../test/corpus/programs.ts';
import { reportedIn } from '../foundation/diagnostics/diagnostic.test-kit.ts';
import { lineMapOf } from '../foundation/text/line-map.ts';
import { stdlibLoader, stdRoles } from '../stdlib/stdlib-loader.ts';
import { stdProgramOf } from './binder/bind.test-kit.ts';
import { binderDiagnostics } from './binder/diagnostics.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { diagnosedAt } from './compile.test-kit.ts';
import { diagnose, diagnoseModule } from './compile.ts';
import { programDiagnostics } from './program/diagnostics.ts';
import { idOf, programOf } from './program/program.test-kit.ts';
import type { Program } from './program/program.ts';
import { scannerDiagnostics } from './scanner/diagnostics.ts';

describe('diagnose', () => {
  it('reports every module by id, clean ones included, in load order', () => {
    const results = diagnose(programOf({ main: "import a from 'a'", a: 'fn a(): 1' }));
    expect(
      [...results].map(([id, result]) => [id, result.source.path, result.diagnostics]),
    ).toEqual([
      [idOf('main'), 'main', []],
      [idOf('a'), 'a', []],
    ]);
  });

  it('merges the diagnostics of every phase, by position', () => {
    const text = [
      "import a from './gone'",
      'fn f():',
      '  const n = 1__0',
      '  const m = nope',
      '  n + true',
      "import b from 'gone/too'",
    ].join('\n');
    const { source, diagnostics } = diagnosedAt(programOf({ 'main.ista': text }), 'main.ista');
    const { unresolvedImport } = programDiagnostics;
    expect(reportedIn(source, diagnostics)).toEqual({
      codes: [
        unresolvedImport.code,
        scannerDiagnostics.misplacedSeparator.code,
        binderDiagnostics.undeclared.code,
        checkerDiagnostics.operatorTypes.code,
        unresolvedImport.code,
      ],
      spanTexts: ["'./gone'", '__', 'nope', 'n + true', "'gone/too'"],
    });
  });

  it('derives once per program', () => {
    const program = programOf({ 'main.ista': '' });
    expect(diagnose(program)).toBe(diagnose(program));
  });
});

describe('the corpus', () => {
  it.each(invalidPrograms)(
    '$name reports exactly the errors it states',
    ({ name, text, errors }) => {
      const { source, diagnostics } = diagnosedAt(stdProgramOf({ [name]: text }), name);
      const lines = lineMapOf(source);
      const reported = diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => {
          const { line, column } = lines.positionAt(diagnostic.span.start);
          return { code: diagnostic.code, line: line + 1, column: column + 1 };
        });
      expect(reported).toEqual(errors);
    },
  );
});

describe('diagnostics, whatever order modules are asked in', () => {
  const lib = [
    'struct Sealed<X is Sendable> { value: X }',
    'struct Box<T, U = Sealed<Slot<Int>>> { first: T }',
  ].join('\n');
  const main = "import Box from 'lib'\nfn first(box: Box<Int>) -> Int: box.first";

  /** The codes each module reports, by module key. */
  function codes(program: Program, keys: readonly string[]): Record<string, readonly number[]> {
    return Object.fromEntries(
      keys.map((key) => [key, diagnosedAt(program, key).diagnostics.map(({ code }) => code)]),
    );
  }

  /** The program of `lib` and `main`, entered from `roots` in that order, so asked in that order. */
  const enteredFrom = (roots: readonly string[]) =>
    programOf({ lib, main }, { roots, roles: stdRoles(), loaders: [stdlibLoader()] });

  it('reports a constraint where it is written, however the program was entered', () => {
    const libFirst = codes(enteredFrom(['lib', 'main']), ['lib', 'main']);
    const mainFirst = codes(enteredFrom(['main', 'lib']), ['main', 'lib']);
    const libAlone = codes(enteredFrom(['lib']), ['lib']);
    expect(libFirst).toEqual(mainFirst);
    expect(libFirst.lib).toEqual(libAlone.lib);
    expect(libAlone.lib).toEqual([checkerDiagnostics.notConforming.code]);
  });
});

describe('a cycle growing through defaults of two modules', () => {
  const files = {
    built: [
      "import Building from 'building'",
      'struct Built<T>:',
      '  f = build<T>()',
      'fn build<T>() -> Building<(T,)>?: none',
    ].join('\n'),
    building: [
      "import Built from 'built'",
      'struct Building<U>:',
      '  g = making<U>()',
      'fn making<U>() -> Built<U>?: none',
    ].join('\n'),
  };
  const codesIn = (key: string, diagnostics: readonly { readonly code: number }[] | undefined) =>
    [key, diagnostics?.map(({ code }) => code)] as const;

  it('is reported at each field, whichever module is diagnosed, alone or with the other', () => {
    const expanding = [checkerDiagnostics.expandingType.code];
    const whole = diagnose(stdProgramOf(files));
    for (const key of ['built', 'building']) {
      const alone = diagnoseModule(stdProgramOf(files), idOf(key)).diagnostics;
      expect(codesIn(key, alone)).toEqual([key, expanding]);
      expect(codesIn(key, whole.get(idOf(key))?.diagnostics)).toEqual([key, expanding]);
    }
  });
});

describe('one module diagnosed alone', () => {
  it.each(invalidPrograms)('reports in $name what diagnosing every module does', ({ text }) => {
    const main = idOf('main.ista');
    const alone = diagnoseModule(stdProgramOf({ 'main.ista': text }), main);
    const whole = diagnose(stdProgramOf({ 'main.ista': text })).get(main);
    expect(alone.diagnostics).toEqual(whole?.diagnostics);
  });
});
