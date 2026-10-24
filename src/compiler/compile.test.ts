/**
 * The coordinator's results: diagnostics from every phase so far, merged per module, keyed by the
 * module's id, and derived once per program.
 */

import { describe, expect, it } from 'vitest';
import { reportedIn } from '../diagnostics/diagnostic.test-kit.ts';
import { binderDiagnostics } from './binder/diagnostics.ts';
import { checkerDiagnostics } from './checker/diagnostics.ts';
import { diagnose, type ModuleDiagnostics } from './compile.ts';
import { programDiagnostics } from './program/diagnostics.ts';
import { type Files, idOf, programOf } from './program/program.test-kit.ts';
import { scannerDiagnostics } from './scanner/diagnostics.ts';

function diagnosedAt(files: Files, path: string): ModuleDiagnostics {
  const result = diagnose(programOf(files)).get(idOf(path));
  if (result === undefined) {
    throw new Error(`${path} was not loaded`);
  }
  return result;
}

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
    const { source, diagnostics } = diagnosedAt({ 'main.ista': text }, 'main.ista');
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
