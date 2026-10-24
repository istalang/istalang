/**
 * The checker through the coordinator, with the real prelude: one invalid case per rule, each
 * reporting its code over the text it explains; valid programs reporting nothing; and totality on
 * broken programs and on every spec example, most of which use constructs not supported yet.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { brokenText } from '../../../test/broken.ts';
import { runPrograms } from '../../../test/corpus/run-programs.ts';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { subsetSource } from '../../../test/definitions/subset.ts';
import {
  reportedIn,
  reportedNothing,
  reportedOnce,
} from '../../diagnostics/diagnostic.test-kit.ts';
import { preludeProgramOf, stdProgramOf } from '../binder/bind.test-kit.ts';
import { diagnose } from '../compile.ts';
import { idOf } from '../program/program.test-kit.ts';
import { checkProgram } from './check.ts';
import { checkerDiagnostics as reports } from './diagnostics.ts';

const corpusTexts = runPrograms.map((program) => program.text);

/** Everything reported for `text` as module `main.ista`, beside the std modules and `others`. */
function reported(text: string, others: Readonly<Record<string, string>> = {}) {
  const program = stdProgramOf({ 'main.ista': text, ...others });
  const result = diagnose(program).get(idOf('main.ista'));
  if (result === undefined) {
    throw new Error('main.ista was not loaded');
  }
  return reportedIn(result.source, result.diagnostics);
}

const importTime = "import * as time from 'time'";

/** `body` as the body of a function taking `c: bool`, `n: int` and `s: string`. */
function inFunction(body: string): string {
  return `struct Point { x: int; y: int }\n\nfn subject(c: bool, n: int, s: string):\n${body
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')}\n`;
}

describe('checking reports', () => {
  it.each([
    ['a value of the wrong type', 'const x: int = "a"', reports.typeMismatch, '"a"'],
    ['a condition that is not bool', 'while n:\n  break', reports.typeMismatch, 'n'],
    ['an operator no function takes', 'n + "a"', reports.operatorTypes, 'n + "a"'],
    ['== across types', 'c == n', reports.operatorTypes, 'c == n'],
    ['branches of different types', 'const v = if c: 1 else: "a"', reports.branchTypes, '"a"'],
    ['a value in an if without else', 'if c: 1', reports.ifWithoutElse, '1'],
    ['reassigning a const', 'const k = 1\nk = 2', reports.constReassigned, 'k'],
    ['a let never reassigned', 'let k = 1\nk', reports.letNeverReassigned, 'k'],
    ['break outside a loop', 'break', reports.outsideLoop, 'break'],
    ['assigning to a function', 'f = 1', reports.notAssignable, 'f'],
    ['a type used as a value', 'Point', reports.notValue, 'Point'],
    ['a literal of a type that is not a struct', 'int{}', reports.notStruct, 'int'],
    ['a field the struct lacks', 'Point{x: 1, y: 2, z: 3}', reports.unknownField, 'z'],
    ['a field given twice', 'Point{x: 1, x: 2, y: 3}', reports.repeatedField, 'x'],
    ['a missing field', 'Point{x: 1}', reports.missingField, 'Point'],
    ['reading a field the struct lacks', 'Point{x: 1, y: 2}.z', reports.unknownField, 'z'],
    ['a trait used as a type', 'const x: Comparable = 1', reports.notType, 'Comparable'],
    ['a construct not supported yet', '[1, 2]', reports.notSupportedYet, '[1, 2]'],
  ])('%s', (_case, body, report, spanText) => {
    expect(reported(`${inFunction(body)}\nfn f() -> int: 1\n`)).toEqual(
      reportedOnce(report.code, spanText),
    );
  });

  it.each([
    [
      'a call with the wrong number of arguments',
      'fn f(a: int) -> int: a\nfn g(): f(1, 2)',
      reports.argumentCount,
      'f(1, 2)',
    ],
    [
      'an argument of the wrong type',
      'fn f(a: int) -> int: a\nfn g(): f("a")',
      reports.typeMismatch,
      '"a"',
    ],
    [
      'arguments no overload takes',
      'fn f(a: int): a\nfn f(a: string): a\nfn g(): f(true)',
      reports.noMatchingOverload,
      'f(true)',
    ],
    [
      'arguments several overloads take',
      'fn f(a: int): a\nfn f(a: string): a\nfn g(): f(panic("x"))',
      reports.ambiguousCall,
      'f(panic("x"))',
    ],
    ['recursion without a declared result', 'fn f(n: int): f(n)', reports.recursiveReturnType, 'f'],
    [
      'a call to an extern the host implements',
      'extern fn tick(n: int) -> int\nfn f(): tick(1)',
      reports.notSupportedYet,
      'tick(1)',
    ],
    [
      'a returned value of the wrong type',
      'fn f() -> int:\n  return "a"',
      reports.typeMismatch,
      '"a"',
    ],
    ['a body of the wrong type', 'fn f() -> int:\n  "a"', reports.typeMismatch, '"a"'],
    [
      'returns that disagree on an inferred result',
      'fn f(c: bool):\n  if c:\n    return 1\n  "a"',
      reports.typeMismatch,
      '"a"',
    ],
    ['an async result that is not a Future', 'async fn f() -> int: 1', reports.asyncResult, 'int'],
    [
      'a type with too few type arguments',
      'struct Pair<A, B> { first: A; second: B }\nfn f(p: Pair<int>): 1',
      reports.typeArgumentCount,
      'Pair<int>',
    ],
    [
      'a namespace called as a function',
      "import * as other from 'other.ista'\nfn f(): other()",
      reports.notCallable,
      'other',
    ],
    [
      'await outside an async function',
      `${importTime}\nfn f(): await time.delay(1s)`,
      reports.awaitOutsideAsync,
      'await time.delay(1s)',
    ],
    [
      'await on a value that is not a Future',
      'async fn f(): await 1',
      reports.awaitNeedsFuture,
      '1',
    ],
    [
      'a future held in a variable',
      `${importTime}\nasync fn f():\n  const t = time.delay(1s)\n  await t`,
      reports.notSupportedYet,
      'time.delay(1s)',
    ],
    [
      'a future discarded',
      `${importTime}\nasync fn f():\n  time.delay(1s)\n  1`,
      reports.notSupportedYet,
      'time.delay(1s)',
    ],
    [
      'a future discarded by a loop body',
      `${importTime}\nfn f(c: bool):\n  while c:\n    time.delay(1s)`,
      reports.notSupportedYet,
      'time.delay(1s)',
    ],
    [
      'a future as a parameter',
      'fn f(x: Future<int>): 1',
      reports.notSupportedYet,
      'x: Future<int>',
    ],
    [
      'a future as a field',
      'struct S { f: Future<int> }',
      reports.notSupportedYet,
      'f: Future<int>',
    ],
    [
      'a call to an extern the host implements',
      'extern fn host() -> int\nfn f(): host()',
      reports.notSupportedYet,
      'host()',
    ],
  ])('%s', (_case, text, report, spanText) => {
    expect(reported(text, { 'other.ista': '' })).toEqual(reportedOnce(report.code, spanText));
  });
});

describe('checking accepts', () => {
  it.each([
    ['the subset program', subsetSource],
    ...corpusTexts.map((text, index) => [`run corpus program ${index}`, text]),
    ['a parameter reassigned', 'fn f(n: int) -> int:\n  n = n + 1\n  n'],
    [
      'never wherever a value is expected',
      'fn f(c: bool) -> int:\n  const x: int = if c: 1 else: panic("x")\n  x',
    ],
    [
      'an if without else whose branches leave',
      'fn f(c: bool) -> int:\n  if c:\n    return 1\n  2',
    ],
    ['a compound assignment', 'fn f() -> float:\n  let x = 1.5\n  x += 2\n  x'],
    [
      'a generic struct with its arguments',
      'struct Box<T> { value: T }\nfn f(b: Box<int>) -> int: b.value',
    ],
    ['a prelude type with a default argument', 'fn f(r: Result<int>) -> Result<int, Error>: r'],
    [
      'awaiting an async call and a std extern',
      `${importTime}\nasync fn g() -> Future<int>: 1\nasync fn f() -> Future<int>:\n  await time.at(time.now())\n  await g()`,
    ],
    ['a future returned to the caller', `${importTime}\nfn f() -> Future<unit>: time.delay(1s)`],
    ['a duration literal without importing time', 'fn f() -> int:\n  const d = 5d\n  d.value'],
    [
      "a duration literal typed as time's Duration",
      "import Duration from 'time'\nfn f() -> Duration: 90m",
    ],
  ])('%s', (_case, text) => {
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('reports a duration literal where the program lacks the time module', () => {
    const program = preludeProgramOf({ 'main.ista': 'fn f(): 5d' });
    const result = diagnose(program).get(idOf('main.ista'));
    const found = result === undefined ? undefined : reportedIn(result.source, result.diagnostics);
    expect(found).toEqual(reportedOnce(reports.missingStdModule.code, '5d'));
  });
});

describe('recursion without declared results', () => {
  const files = {
    'a.ista': "import g from 'b.ista'\nfn f(n: int): g(n)\n",
    'b.ista': "import f from 'a.ista'\nfn g(n: int): f(n)\n",
  };

  it('is reported at every function of the cycle, whichever module is checked first', () => {
    const reportsWhenFirst = (first: string) => {
      const program = preludeProgramOf(files);
      const checker = checkProgram(program);
      const order = first === 'a.ista' ? ['a.ista', 'b.ista'] : ['b.ista', 'a.ista'];
      for (const key of order) {
        checker.diagnosticsOf(idOf(key));
      }
      return ['a.ista', 'b.ista'].map((key) => checker.diagnosticsOf(idOf(key)).map((d) => d.code));
    };
    const { code } = reports.recursiveReturnType;
    expect(reportsWhenFirst('a.ista')).toEqual([[code], [code]]);
    expect(reportsWhenFirst('b.ista')).toEqual([[code], [code]]);
  });
});

describe('checking is total', () => {
  const modules = specExamples.filter((example) => example.form === 'module').map((e) => e.code);

  it('never throws on any spec example, whatever it reports', () => {
    for (const text of modules) {
      expect(() => reported(text)).not.toThrow();
    }
  });

  it('never throws on broken programs', () => {
    fc.assert(
      fc.property(brokenText([subsetSource, ...corpusTexts, ...modules]), (text) => {
        expect(() => reported(text)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});
