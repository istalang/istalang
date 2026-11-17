/**
 * Inferring type arguments (§3.5) doesn't depend on the order the arguments come in: whatever the
 * order, a call either infers the same type or reports the same thing. A type found where a value
 * must have it exactly is the parameter's own, which a convertible argument can't widen.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../../../../test/timeouts.ts';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { binderDiagnostics } from '../../../binder/diagnostics.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

/** Arguments of different types, some fitting each other only by the implicit wrap (§2). */
const argumentTexts = ['1', 'maybe', '2', '"x"', 'none'];

function reportedCodes(argumentsText: readonly string[]): readonly number[] {
  return reportedErrors(
    [
      'fn same<T>(a: T, b: T, c: T) -> T: a',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const maybe: Int? = 3',
      `  const result = same(${argumentsText.join(', ')})`,
    ].join('\n'),
  );
}

/** The codes of the errors `main` reports. */
function reportedErrors(main: string): readonly number[] {
  const { diagnostics } = diagnosedAt(stdProgramOf({ main }), 'main');
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.code);
}

describe('type-argument inference', () => {
  it('reports the same for every order of the same arguments', {
    timeout: slowTestTimeout,
  }, () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(argumentTexts, { minLength: 3, maxLength: 3 }),
        fc.nat(5),
        (chosen, rotation) => {
          const rotated = [...chosen.slice(rotation % 3), ...chosen.slice(0, rotation % 3)];
          expect(reportedCodes(rotated)).toEqual(reportedCodes(chosen));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('a type found where a value must have it exactly', () => {
  const declarations = [
    'fn setFirst<T>(a: &T, b: T): a = b',
    'fn setLast<T>(b: T, a: &T): a = b',
    'fn collect<T>(first: T, ...rest: Array<T>) -> Int: rest.length()',
  ];

  it.each([
    ['a reference after an optional', 'setLast(maybe, &n)'],
    ['a reference before an optional', 'setFirst(&n, maybe)'],
    ["a spread's items after an optional", 'collect(maybe, ...ns)'],
  ])('never widens to an optional, for %s', (_case, call) => {
    const main = [
      ...declarations,
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const maybe: Int? = 3',
      '  const ns = [1, 2]',
      '  let n = 1',
      `  ${call}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual([checkerDiagnostics.cannotInfer.code]);
  });
});

describe('never where a value must have its type exactly', () => {
  it.each([
    ["a spread's items before a value", 'gather(...empty, 1)'],
    ["a spread's items after a value", 'gather(1, ...empty)'],
    ["a function's result before a value", 'runFirst(failing, 1)'],
    ["a function's result after a value", 'runLast(1, failing)'],
    ["a function's result alone", 'runAlone(failing)'],
    ['a direct Never argument', 'keep(panic("x"))'],
    ['a struct field given Never', 'Box{value: panic("x")}'],
  ])('binds only what nothing else does, for %s', (_case, call) => {
    const main = [
      'struct Box<T> { value: T }',
      'fn keep<T>(x: T) -> T: x',
      'fn gather<T>(...items: Array<T>) -> Int: items.length()',
      'fn runFirst<T>(f: fn() -> T, fallback: T) -> T: fallback',
      'fn runLast<T>(fallback: T, f: fn() -> T) -> T: fallback',
      'fn runAlone<T>(f: fn() -> T) -> Int: 0',
      'fn fail() -> Never: panic("x")',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const empty: Array<Never> = []',
      '  const failing = fail',
      `  drop ${call}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
  });
});

describe('a generic struct literal joining fields across none', () => {
  it.each([
    ['value then none', 'Pair{a: 1, b: none}'],
    ['none then value', 'Pair{a: none, b: 1}'],
  ])('joins T with None into T?, for %s', (_case, literal) => {
    const main = [
      'struct Pair<T> { a: T, b: T }',
      'fn main():',
      `  const p: Pair<Int?> = ${literal}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
  });
});

describe('a parameter only never gives', () => {
  it.each([
    ['takes the type the result is expected to have', 'const xs: Array<Int> = wrapped(failing)'],
    ['takes it before its constraints are checked', 'const x: Int = shown(failing)'],
  ])('%s', (_case, statement) => {
    const main = [
      'fn wrapped<T>(f: fn() -> T) -> Array<T>: [f()]',
      'fn shown<T is Stringable>(f: fn() -> T) -> T: f()',
      'fn fail() -> Never: panic("x")',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const failing = fail',
      `  ${statement}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
  });
});

describe('member parameters (§3.5)', () => {
  const declarations = [
    'type Status = "draft" | "sent" | "failed"',
    'fn describe<S in Status>(s: S) -> S: s',
    'fn either<T in Int | String>(x: T) -> T: x',
  ];

  it.each([
    ['a literal of a literal member', 'describe("draft")', []],
    ['a value of one member', 'describe(sent)', []],
    ['a literal outside the union', 'describe("other")', [checkerDiagnostics.typeMismatch.code]],
    [
      'a value of several members',
      'describe(status)',
      [checkerDiagnostics.severalMembersArgument.code],
    ],
    ['a literal of a member base', 'either(1)', []],
    ['a literal type of a member base', 'either(one)', []],
    [
      'a value of several base members',
      'either(both)',
      [checkerDiagnostics.severalMembersArgument.code],
    ],
  ])('are filled by %s: %s', (_case, call, codes) => {
    const main = [
      ...declarations,
      'fn main(status: Status, sent: "sent", one: 1, both: Int | String):',
      `  _ = ${call}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual(codes);
  });
});

describe('a parameter the error type met', () => {
  it.each([
    ["inside a method's receiver", 'rows().length()', 1],
    ["inside a function's argument", 'first(rows())', 1],
    ["as a function's argument", 'same(missing, missing)', 3],
  ])('is the error type, which reports nothing more, for %s', (_case, call, undeclared) => {
    const main = [
      'fn rows() -> Array<Missing>: []',
      'fn first<T>(xs: Array<T>) -> T: xs[0]',
      'fn same<T>(a: T, b: T) -> T: a',
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      `  drop ${call}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual(
      Array.from({ length: undeclared }, () => binderDiagnostics.undeclared.code),
    );
  });
});

describe('a recursive type inside what is given', () => {
  it.each([
    ['inside an optional', 'headOf(maybe)', 'fn headOf<T>(l: List<T>?) -> T?: l?.head'],
    ['inside an array', 'firstHead(xs)', 'fn firstHead<T>(xs: Array<List<T>>) -> T: xs[0].head'],
    ['inside itself', 'second(l)', 'fn second<T>(l: List<T>) -> T?: l.tail?.head'],
  ])('is matched as it unfolds, %s', (_case, call, declaration) => {
    const main = [
      'type List<T> = { head: T, tail: List<T>? }',
      declaration,
      "import * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main():",
      '  const l: List<Int> = struct{head: 1, tail: none}',
      '  const maybe: List<Int>? = l',
      '  const xs: Array<List<Int>> = [l]',
      `  const found = ${call}`,
      '  const n: Int? = found',
    ].join('\n');
    expect(reportedErrors(main)).toEqual([]);
  });
});

describe("a generic function's own call inside its body", () => {
  it.each([
    ['given its parameter', 'fn again<T>(xs: Array<T>) -> Array<T>: again(xs)'],
    [
      'given a function of its parameter',
      'fn sortedBy<T>(xs: Array<T>, order: fn(T, T) -> Int) -> Array<T>: sortedBy(xs, order)',
    ],
    ['as an argument of another call', 'fn twice<T>(xs: Array<T>) -> Array<T>: twice(twice(xs))'],
    [
      'with swapped type arguments',
      'fn swap<A, B>(a: A, b: B, flip: Bool) -> Int:\n  if flip: swap(b, a, false) else: 0',
    ],
    [
      'with a concrete and a parameter argument',
      'fn shift<T, U>(x: T, y: U, stop: Bool) -> Int:\n  if stop: 0 else: shift(1, x, true)',
    ],
    [
      'choosing among overloads by its own parameter',
      'fn process(x: Int, y: Int, stop: Bool) -> Int: 1\nfn process<T>(x: T, y: T, stop: Bool) -> Int:\n  if stop: 0 else: process(y, y, true)',
    ],
  ])('gives its type parameters what the call passes, %s', (_case, declaration) => {
    expect(
      reportedErrors(`${declaration}\nimport * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main():\n  drop 1`),
    ).toEqual([]);
  });
});
