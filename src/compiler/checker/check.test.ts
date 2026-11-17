/**
 * The checker through the coordinator, with the real prelude: one invalid case per rule, each
 * reporting its code over the text it explains; valid programs reporting nothing; the spec's and
 * the guide's module examples checking clean; and totality on broken programs and on every spec
 * example.
 *
 * Each module example is checked on its own, but §12.1's, which make one program together and are
 * checked joined. The examples that don't check clean yet are listed by section and place in it,
 * most because they use declarations their document leaves out; a listed example that comes to
 * check clean fails until it leaves the list, so the list only shrinks.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { brokenText } from '../../../test/broken.ts';
import { runPrograms } from '../../../test/corpus/programs.ts';
import { type SpecExample, specExamples } from '../../../test/corpus/spec-examples.ts';
import { subsetSource } from '../../../test/subset.ts';
import { slowTestTimeout } from '../../../test/timeouts.ts';
import {
  reportedIn,
  reportedNothing,
  reportedOnce,
} from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { preludeProgramOf } from '../binder/bind.test-kit.ts';
import { diagnose } from '../compile.ts';
import { idOf } from '../program/program.test-kit.ts';
import { inFunction, reported } from './check.test-kit.ts';
import { checkProgram } from './check.ts';
import { checkerDiagnostics as reports } from './diagnostics/index.ts';

const corpusTexts = runPrograms.map((program) => program.text);

const importTime = "import * as time from 'time'";

describe('checking reports', () => {
  it.each([
    ['a value of the wrong type', 'const x: Int = "a"', reports.typeMismatch, '"a"'],
    ['a condition that is not bool', 'while n:\n  break', reports.typeMismatch, 'n'],
    ['an operator no function takes', 'n - "a"', reports.operatorTypes, 'n - "a"'],
    ['== across types', 'c == n', reports.operatorTypes, 'c == n'],
    ['branches of different types', 'const v = if c: 1 else: "a"', reports.branchTypes, '"a"'],
    [
      'branches of different types assigned to _',
      '_ = if c: 1 else: "a"',
      reports.branchTypes,
      '"a"',
    ],
    ['a value in an if without else', 'if c: 1', reports.ifWithoutElse, '1'],
    ['reassigning a const', 'const k = 1\nk = 2', reports.constReassigned, 'k'],
    ['a let never reassigned', 'let k = 1\nk', reports.letNeverReassigned, 'k'],
    ['break outside a loop', 'break', reports.outsideLoop, 'break'],
    ['assigning to a function', 'f = 1', reports.notAssignable, 'f'],
    ['a type used as a value', 'Point', reports.notValue, 'Point'],
    ['a literal of a type that is not a struct', 'Int{}', reports.notStruct, 'Int'],
    ['a field the struct lacks', 'Point{x: 1, y: 2, z: 3}', reports.unknownField, 'z'],
    ['a field given twice', 'Point{x: 1, x: 2, y: 3}', reports.repeatedField, 'x'],
    ['a missing field', 'Point{x: 1}', reports.missingField, 'Point'],
    ['reading a field the struct lacks', 'Point{x: 1, y: 2}.z', reports.unknownField, 'z'],
    ['a trait used as a type', 'const x: Comparable = 1', reports.notType, 'Comparable'],
    ['a spread with no rest parameter to fill', 'f(...[1])', reports.spreadWithoutRest, '[1]'],
  ])('%s', (_case, body, report, spanText) => {
    expect(reported(`${inFunction(body)}\nfn f() -> Int: 1\n`)).toEqual(
      reportedOnce(report.code, spanText),
    );
  });

  it.each([
    [
      'a call with the wrong number of arguments',
      'fn f(a: Int) -> Int: a\nfn g(): f(1, 2)',
      reports.argumentCount,
      'f(1, 2)',
    ],
    [
      'an argument of the wrong type',
      'fn f(a: Int) -> Int: a\nfn g(): f("a")',
      reports.typeMismatch,
      '"a"',
    ],
    [
      'arguments no overload takes',
      'fn f(a: Int): a\nfn f(a: String): a\nfn g(): f(true)',
      reports.noMatchingOverload,
      'f(true)',
    ],
    [
      'arguments several overloads take',
      'fn f(a: Int): a\nfn f(a: String): a\nfn g(): f(panic("x"))',
      reports.ambiguousCall,
      'f(panic("x"))',
    ],
    ['recursion without a declared result', 'fn f(n: Int): f(n)', reports.recursiveReturnType, 'f'],
    [
      'a top-level constant computed by a call',
      'fn g(): 1\nconst x = g()',
      reports.notConstant,
      'g()',
    ],
    [
      'a top-level constant computed by arithmetic',
      'const x = 1 + 2',
      reports.notConstant,
      '1 + 2',
    ],
    [
      'a top-level constant computed by a branch, inside a struct',
      'struct P { x: Int }\nconst p = P{x: if true: 1 else: 2}',
      reports.notConstant,
      'if true: 1 else: 2',
    ],
    [
      'a top-level constant not fitting its annotation',
      'const x: Int = "one"',
      reports.typeMismatch,
      '"one"',
    ],
    [
      "an extern the host implements taking a function, which isn't Encodable",
      'extern fn run(f: fn() -> Int)',
      reports.notConforming,
      'f: fn() -> Int',
    ],
    [
      'a returned value of the wrong type',
      'fn f() -> Int:\n  return "a"',
      reports.typeMismatch,
      '"a"',
    ],
    ['a body of the wrong type', 'fn f() -> Int:\n  "a"', reports.typeMismatch, '"a"'],
    [
      'returns that disagree on an inferred result',
      'fn f(c: Bool):\n  if c:\n    return 1\n  "a"',
      reports.typeMismatch,
      '"a"',
    ],
    [
      'a conversion spelled lowercase',
      'fn f() -> Int: int(1.5)',
      reports.lowercaseConversion,
      'int(1.5)',
    ],
    [
      'a type with too few type arguments',
      'struct Pair<A, B> { first: A, second: B }\nfn f(p: Pair<Int>): 1',
      reports.typeArgumentCount,
      'Pair<Int>',
    ],
    [
      'a namespace called as a function',
      "import * as other from 'other.ista'\nfn f(): other()",
      reports.notCallable,
      'other',
    ],
    [
      'await outside an async function',
      `${importTime}\nista fn f(): await time.delay(1s)`,
      reports.awaitOutsideAsync,
      'await time.delay(1s)',
    ],
    [
      'await on a value that is not a Future',
      'ista async fn f(): await 1',
      reports.awaitNeedsFuture,
      '1',
    ],
    [
      'a future discarded',
      `${importTime}\nista async fn f():\n  time.delay(1s)\n  1`,
      reports.unusedValue,
      'time.delay(1s)',
    ],
    [
      'a future discarded by a loop body',
      `${importTime}\nista fn f(c: Bool):\n  while c:\n    time.delay(1s)`,
      reports.unusedValue,
      'time.delay(1s)',
    ],
    [
      'an extern the host implements taking a reference, which JSON cannot write back',
      'extern fn bump(n: &Int)',
      reports.hostReference,
      'n: &Int',
    ],
  ])('%s', (_case, text, report, spanText) => {
    expect(reported(text, { 'other.ista': '' })).toEqual(reportedOnce(report.code, spanText));
  });
});

describe('checking accepts', () => {
  it.each([
    ['the subset program', subsetSource],
    ...corpusTexts.map((text, index) => [`run corpus program ${index}`, text]),
    [
      'never wherever a value is expected',
      'fn f(c: Bool) -> Int:\n  const x: Int = if c: 1 else: panic("x")\n  x',
    ],
    [
      'an if without else whose branches leave',
      'fn f(c: Bool) -> Int:\n  if c:\n    return 1\n  2',
    ],
    ['a compound assignment', 'fn f() -> Float:\n  let x = 1.5\n  x += 2\n  x'],
    [
      'a generic struct with its arguments',
      'struct Box<T> { value: T }\nfn f(b: Box<Int>) -> Int: b.value',
    ],
    ['a prelude type with a default argument', 'fn f(r: Result<Int>) -> Result<Int, Error>: r'],
    [
      'awaiting an async call and a std extern',
      `${importTime}\nista async fn g() -> Int: 1\nista async fn f() -> Int:\n  await time.at(time.now())\n  await g()`,
    ],
    [
      'a future returned to the caller',
      `${importTime}\nista fn f() -> Future<Unit, "ista">: time.delay(1s)`,
    ],
    [
      'a future returned through parentheses, a block, an if and a return',
      `${importTime}\nista fn f(c: Bool) -> Future<Unit, "ista">:\n  if c:\n    return (time.delay(1s))\n  { const d = 2s; if c: time.delay(d) else: time.delay(3s) }`,
    ],
    ['a duration literal without importing time', 'fn f() -> Int:\n  const d = 5d\n  d.value'],
    [
      'top-level constants used by functions and by each other',
      'struct P { x: Int, y: Int }\nconst origin = P{x: zero, y: -1}\nconst zero = 0\nfn f() -> Int: origin.x + origin.y',
    ],
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
    'a.ista': "import g from 'b.ista'\nfn f(n: Int): g(n)\n",
    'b.ista': "import f from 'a.ista'\nfn g(n: Int): f(n)\n",
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

describe('top-level constants hold only what compile time computes', () => {
  it.each([
    ['a call', 'fn one() -> Int: 1\nconst x = one()', 'one()', reports.notConstant],
    ['a tuple element', 'const t = (1, 2)\nconst x = t.0', 't.0', reports.notConstant],
    [
      'a map literal of a type other than Map, which calls its functions',
      'struct Bag {}\nfn Bag.default() -> Bag: Bag\nfn setIndex(self: &Bag, key: Int, value: Int):\n  return\nconst b: Bag = [1: 1]',
      '[1: 1]',
      reports.notConstant,
    ],
  ])('refuse %s, whatever else reports it', (_case, text, spanText, report) => {
    const { codes, spanTexts } = reported(text);
    const pairs = codes.map((code, index) => [code, spanTexts[index]]);
    expect(pairs).toContainEqual([report.code, spanText]);
  });
});

/** The spec section whose module examples make one program. */
const programSection = '12.1 Purchase approval';

/**
 * Doc module examples that don't check clean yet, keyed by `document › section #n`, which survives
 * edits above them, each with the codes it reports, so a new kind of report fails the test as a
 * report in a clean example does.
 */
const uncheckedExamples = new Map<string, readonly number[]>([
  ['docs/spec.md › 3.1 Structs #1', [4000]],
  ['docs/spec.md › 3.3 Functions #1', [2001, 4000, 5001]],
  ['docs/spec.md › 3.6 Extern declarations #1', [4000]],
  ['docs/spec.md › 3.7 Methods and references #2', [4000, 5103]],
  ['docs/spec.md › 3.7 Methods and references #3', [2001, 4000]],
  ['docs/spec.md › 3.7 Methods and references #4', [4000, 5026]],
  ['docs/spec.md › 3.9 Operator overloading #1', [4000]],
  ['docs/spec.md › 3.10 Traits #1', [2001, 4008, 5001]],
  ['docs/spec.md › 3.13 Modules #1', [2001, 3000, 5001]],
  ['docs/spec.md › 3.14 Function types and closures #2', [5105]],
  ['docs/spec.md › 5. Persistence #1', [4000, 5103]],
  ['docs/spec.md › 6. Slots and inboxes #1', [4000]],
  ['docs/spec.md › 7. Lifetimes and disposal #1', [4008]],
  ['docs/spec.md › 7. Lifetimes and disposal #2', [4000, 5103]],
  ['docs/spec.md › 7. Lifetimes and disposal #3', [4000]],
  ['docs/spec.md › 7. Lifetimes and disposal #4', [4000]],
  ['docs/spec.md › 9. Program structure #1', [4000]],
  ['docs/spec.md › 10. Testing #1', [4000]],
  ['docs/spec.md › 12.2 Approver side #1', [4000]],
  ['docs/spec.md › 12.3 Broadcast with expiry #1', [4000]],
  ['docs/guide.md › Level 0: what it is #1', [4000, 5103]],
  ['docs/guide.md › 2.1 A whole program #1', [4000]],
  ['docs/guide.md › 2.5 Generics, traits, operators (§3.5, §3.9, §3.10) #1', [4000]],
  ['docs/guide.md › 2.7 Errors (§3.12) #1', [4000]],
  ['docs/guide.md › 2.9 Concurrency (§6, §8, §9) #1', [5022, 5026, 5103]],
  ['docs/guide.md › 2.11 Modules, host, JSON, tools (§3.6, §3.13, §9, §11) #1', [3000]],
  ['docs/guide.md › 2.12 Testing (§10) #1', [4000, 5214]],
]);

/**
 * A doc module example to check, the line its code starts on, and its key in `uncheckedExamples`.
 */
interface CheckedExample {
  readonly key: string;
  readonly document: string;
  readonly line: number;
  readonly text: string;
}

function isProgramExample(example: SpecExample): boolean {
  return example.document === 'docs/spec.md' && example.section === programSection;
}

/** Each doc module example to check, and §12.1's joined as one program. */
function checkedExamples(): readonly CheckedExample[] {
  const modules = specExamples.filter(
    (example) => example.form === 'module' && !example.elided && !isProgramExample(example),
  );
  const bySection = Map.groupBy(modules, (example) => `${example.document} › ${example.section}`);
  const program = specExamples.filter(isProgramExample);
  return [
    ...[...bySection].flatMap(([section, examples]) =>
      examples.map((example, index) => ({
        key: `${section} #${index + 1}`,
        document: example.document,
        line: example.line,
        text: example.code,
      })),
    ),
    {
      key: `docs/spec.md › ${programSection}`,
      document: 'docs/spec.md',
      line: program[0]?.line ?? 0,
      text: program.map(({ code }) => code).join('\n'),
    },
  ];
}

/** The codes `text` reports, each once, in order. */
function reportedCodes(text: string): readonly number[] {
  return [...new Set(reported(text).codes)].sort((left, right) => left - right);
}

describe('doc examples', () => {
  const examples = checkedExamples();
  const unchecked = examples.flatMap((example) => {
    const codes = uncheckedExamples.get(example.key);
    return codes === undefined ? [] : [{ ...example, codes }];
  });

  it.each(examples.filter(({ key }) => !uncheckedExamples.has(key)))(
    'check clean: $document:$line',
    ({ text }) => {
      expect(reported(text)).toEqual(reportedNothing);
    },
  );

  it.each(unchecked)('report only the codes listed: $document:$line', ({ text, codes }) => {
    expect(reportedCodes(text)).toEqual(codes);
  });

  it('list only examples that exist', () => {
    const keys = new Set(examples.map(({ key }) => key));
    expect([...uncheckedExamples.keys()].filter((key) => !keys.has(key))).toEqual([]);
  });
});

describe('checking is total', () => {
  const modules = specExamples.filter((example) => example.form === 'module').map((e) => e.code);

  it('never throws on any spec example, whatever it reports', () => {
    for (const text of modules) {
      expect(() => reported(text)).not.toThrow();
    }
  });

  it('never throws on a declaration the parser found no name for, whose fields make no value', () => {
    const nameless = [
      'enum<T>:\n  Some(value: T)\n  Empty\nfn f() -> Int: 1',
      'struct<T>:\n  b: Int = 1\nfn f() -> Int: 1',
    ];
    for (const text of nameless) {
      expect(() => reported(text)).not.toThrow();
    }
  });

  it('never throws on broken programs', { timeout: slowTestTimeout }, () => {
    fc.assert(
      fc.property(brokenText([subsetSource, ...corpusTexts, ...modules]), (text) => {
        expect(() => reported(text)).not.toThrow();
      }),
      { numRuns: 300 },
    );
    // Each run checks a program whole, static lifetimes' summaries included.
  });
});
