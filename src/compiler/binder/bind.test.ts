/**
 * The binder's rules (§2, §3.1, §3.4, §3.11, §3.13): one invalid case per rule, reported once at
 * the offending name; valid programs, the prelude and §12 binding cleanly; totality on broken
 * programs; and reuse of unchanged modules' bindings across snapshots.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { brokenText } from '../../../test/broken.ts';
import namesLib from '../../../test/corpus/names/lib.ista';
import namesMain from '../../../test/corpus/names/main.ista';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { reportedOnce } from '../../diagnostics/diagnostic.test-kit.ts';
import { preludeModule } from '../../stdlib/stdlib-loader.ts';
import { idOf, moduleAt } from '../program/program.test-kit.ts';
import { boundReport, preludeProgramOf } from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';
import { bindModule } from './bind-module.ts';
import { binderDiagnostics as d } from './diagnostics.ts';

const corpus = { 'names/main': namesMain, 'names/lib': namesLib };

describe('binding reports, once and at the name', () => {
  it.each([
    ['an undeclared value', 'fn f() -> int: missing', d.undeclared, 'missing'],
    ['an undeclared type', 'fn f(x: Missing): x', d.undeclared, 'Missing'],
    ['Self outside a trait', 'fn f(x: Self): x', d.undeclared, 'Self'],
    ['assigning to an undeclared name', 'fn f():\n  total = 1', d.assignmentToUndeclared, 'total'],
    [
      'a local function used before it',
      'fn f():\n  g()\n  fn g(): 1',
      d.usedBeforeDeclaration,
      'g',
    ],
    [
      'a variable used before it',
      'fn f() -> int:\n  const y = x\n  const x = 1\n  y',
      d.usedBeforeDeclaration,
      'x',
    ],
    [
      'a name after its block ended',
      'fn f() -> int:\n  if true:\n    const x = 1\n  x',
      d.blockEnded,
      'x',
    ],
    [
      'a loop variable after the loop',
      'fn f(xs: Array<int>) -> int:\n  for x in xs:\n    drop x\n  x',
      d.blockEnded,
      'x',
    ],
    [
      'a binding under or',
      'fn f(r: Result<int>) -> int:\n  if r is Ok{value} or false:\n    value\n  else:\n    0',
      d.boundUnderOr,
      'value',
    ],
    [
      'a name declared twice in a block',
      'fn f():\n  const a = 1\n  const a = 2',
      d.duplicateDeclaration,
      'a',
    ],
    [
      'two local functions of one name',
      'fn f():\n  fn g(): 1\n  fn g(): 2',
      d.duplicateDeclaration,
      'g',
    ],
    ['a repeated parameter', 'fn f(a: int, a: int): a', d.duplicateDeclaration, 'a'],
    [
      'a repeated binding in a pattern',
      'fn f(p: (int, int)) -> int:\n  match p:\n    case (a, a): a',
      d.duplicateDeclaration,
      'a',
    ],
    ['a repeated field', 'struct P { x: int; x: int }', d.duplicateDeclaration, 'x'],
    [
      'a repeated top-level type',
      'struct A { x: int }\nstruct A { y: int }',
      d.duplicateDeclaration,
      'A',
    ],
    ['a constant named like a function', 'fn a(): 1\nconst a = 2', d.duplicateDeclaration, 'a'],
    ['a prelude type redeclared', 'struct Result { value: int }', d.preludeClash, 'Result'],
    [
      'a variant an enum lacks, in a pattern',
      'fn f(o: int?) -> int:\n  match o:\n    case Optional.Nothing: 0\n    case _: 1',
      d.missingVariant,
      'Nothing',
    ],
    [
      'an is binding after the expression that bound it',
      'fn f(r: Result<int>) -> int:\n  const ok = r is Ok{value} and value > 0\n  value',
      d.blockEnded,
      'value',
    ],
    [
      'an is binding after its if',
      'fn f(r: Result<int>) -> int:\n  if r is Ok{value}:\n    drop value\n  value',
      d.blockEnded,
      'value',
    ],
    ['a lowercase type', 'struct point { x: int }', d.typeNameConvention, 'point'],
    ['a lowercase type parameter', 'fn f<t>(x: t): x', d.typeNameConvention, 't'],
    ['a lowercase variant', 'enum Color { red; Green }', d.typeNameConvention, 'red'],
    ['a PascalCase function', 'fn Compute(): 1', d.valueNameConvention, 'Compute'],
    ['a PascalCase field', 'struct Point { X: int }', d.valueNameConvention, 'X'],
    ['a snake_case variable', 'fn f():\n  const user_id = 1', d.valueNameConvention, 'user_id'],
    ['reading _', 'fn f():\n  _ = 1\n  drop _', d.unnamedRead, '_'],
  ])('%s', (_, text, rule, name) => {
    expect(boundReport({ main: text })).toEqual(reportedOnce(rule.code, name));
  });

  it.each([
    [
      'a name imported twice',
      { main: "import a from 'lib'\nimport a from 'lib'", lib: 'fn a(): 1' },
      d.duplicateImport,
      'a',
    ],
    [
      'an import clashing with a declaration',
      { main: "import a from 'lib'\nfn a(): 2", lib: 'fn a(): 1' },
      d.importClash,
      'a',
    ],
    [
      'an import of a private name',
      { main: "import _hidden from 'lib'", lib: 'fn _hidden(): 1' },
      d.privateExport,
      '_hidden',
    ],
    [
      'an import the module lacks',
      { main: "import nothing from 'lib'", lib: 'fn a(): 1' },
      d.missingExport,
      'nothing',
    ],
    [
      'a namespace member the module lacks',
      { main: "import * as m from 'lib'\nfn f(): m.nothing()", lib: 'fn a(): 1' },
      d.missingExport,
      'nothing',
    ],
    [
      'an imported type the prelude has',
      { main: "import Error from 'lib'", lib: 'struct Error { text: string }' },
      d.preludeClash,
      'Error',
    ],
  ])('%s', (_, files, rule, name) => {
    expect(boundReport(files)).toEqual(reportedOnce(rule.code, name));
  });
});

describe('valid programs bind without diagnostics', () => {
  it('the prelude', () => {
    const program = preludeProgramOf({ main: '' });
    const { id } = preludeModule();
    expect(program.prelude).toBe(id);
    expect(bindProgram(program).diagnosticsOf(id)).toEqual([]);
  });

  it('the names corpus, both modules', () => {
    expect(boundReport(corpus, 'names/main')).toEqual({ codes: [], spanTexts: [] });
    expect(boundReport(corpus, 'names/lib')).toEqual({ codes: [], spanTexts: [] });
  });

  it('§12.1, its examples joined into one module', () => {
    const purchase = specExamples
      .filter((example) => example.section === '12.1')
      .map((example) => example.code)
      .join('\n');
    expect(boundReport({ main: purchase })).toEqual({ codes: [], spanTexts: [] });
  });

  it('a static function of an enum, which only the checker can tell from a variant', () => {
    const text =
      'enum Color { Red; Green }\nfn Color.default() -> Color: Color.Red\nfn f() -> Color: Color.default()';
    expect(boundReport({ main: text })).toEqual({ codes: [], spanTexts: [] });
  });

  it('a top-level function extends the prelude function of its name', () => {
    expect(
      boundReport({ main: 'struct Book { title: string }\nfn read(self: Book): self.title' }),
    ).toEqual({ codes: [], spanTexts: [] });
  });
});

describe('totality', () => {
  const texts = [
    namesMain,
    ...specExamples.filter(({ form }) => form === 'module').map(({ code }) => code),
  ];

  it('binds programs broken at random without throwing, every diagnostic within the source', () => {
    fc.assert(
      fc.property(brokenText(texts), (text) => {
        const program = preludeProgramOf({ main: text, 'names/lib': namesLib });
        const diagnostics = bindProgram(program).diagnosticsOf(idOf('main'));
        const outside = diagnostics.filter(({ span }) => span.start < 0 || span.end > text.length);
        expect(outside).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('incremental', () => {
  it('reuses the bindings and entities of every module an edit did not touch', () => {
    const before = preludeProgramOf(corpus);
    const after = preludeProgramOf({ ...corpus, 'names/main': `${namesMain}\n` }, before);
    const treeOf = (program: typeof before, key: string) => moduleAt(program, key).tree;
    expect(bindModule(treeOf(after, 'names/lib'))).toBe(bindModule(treeOf(before, 'names/lib')));
    expect(bindModule(treeOf(after, 'names/main'))).not.toBe(
      bindModule(treeOf(before, 'names/main')),
    );
    const shapeIn = (program: typeof before) =>
      bindProgram(program).exportsOf(idOf('names/lib')).get('Shape');
    expect(shapeIn(after)).toBe(shapeIn(before));
  });
});
