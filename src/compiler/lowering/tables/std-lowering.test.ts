/**
 * A program lowered after others over its std, taking over the std's entries they kept
 * (std-lowering.ts), lowers to the Definition it lowers to with nothing kept, byte for byte,
 * whichever programs came before it and in whatever order: a program build and a test build alike.
 * The corpus sweep holds every corpus program to the same (test/sweep/checks/std-reuse.ts).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../../../test/timeouts.ts';
import { encodeDefinition } from '../../../definition/definition.ts';
import { isError } from '../../../foundation/diagnostics/diagnostic.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import type { Checker } from '../../checker/check.ts';
import { checkedAfterStd } from '../../compile.test-kit.ts';
import { diagnose, mainOf, suitesOf } from '../../compile.ts';
import { idOf } from '../../program/program.test-kit.ts';
import { lower, lowerTests } from '../lower.ts';
import { StdLowering } from './std-lowering.ts';

const runMain = 'live async fn main() -> Int: await runtime.run(runtime.id()) _main()';
const imports = "import * as runtime from 'runtime'";

/** Programs reaching different parts of the std, each lowered by `build`. */
const programs = [
  {
    name: 'generic instances over the std and over its own types',
    files: {
      main: [
        imports,
        'struct Money:\n  cents: Int',
        runMain,
        'ista async fn _main() -> Int:',
        '  const sums = [Money{cents: 1}, Money{cents: 2}].map(fn(m: Money) -> Int: m.cents)',
        '  const named: Map<String, Int> = ["a": 1]',
        '  sums[0] + (named.get("a") ?? 0) + [1, 2].filter(fn(n: Int) -> Bool: n > 1).length()',
      ].join('\n'),
    },
  },
  {
    name: 'closures compared, a union and an optional',
    files: {
      main: [
        imports,
        'fn made<T>(x: T) -> fn() -> Int: fn() -> Int: 1',
        runMain,
        'ista async fn _main() -> Int:',
        '  const pick: Int | String = "a"',
        '  const maybe: Int? = none',
        '  if made(1) == made([1]) and pick is String:',
        '    return maybe ?? 2',
        '  0',
      ].join('\n'),
    },
  },
  {
    name: 'a delegated job, which reaches the job server',
    files: {
      main: [
        imports,
        runMain,
        'ista async fn _main() -> Int: await runtime.delegate(fn() -> Int: 4)',
      ].join('\n'),
    },
  },
  {
    name: 'a test module, lowered as a test build',
    files: {
      'main.test.ista': [
        "import Suite, Test, test, assertEq from 'testing'",
        '@Suite{"sums"}',
        'fn sums() -> Array<Test>: [',
        '  test("adds", fn(): assertEq([1, 2].map(fn(n: Int) -> Int: n + 1)[0], 2)),',
        ']',
      ].join('\n'),
    },
  },
  {
    name: 'a test module calling a std generic std code calls at a heap type, mocking nothing',
    files: { 'main.test.ista': flatMapTests('    drop 0') },
  },
  {
    name: 'a test module mocking that std generic, never shared across types where mocked',
    files: {
      'main.test.ista': flatMapTests(
        '    hold _ = mock(map<Int, Array<String>, "simple">, fn(xs: Array<Int>, f: fn(Int) -> Array<String>) -> Array<Array<String>>: [["m"]])',
      ),
    },
  },
] as const;

/** A test of `flatMap`, which the std's own code makes a `map` at a heap type of; `before` first. */
function flatMapTests(before: string): string {
  return [
    "import Suite, Test, test, assert, mock from 'testing'",
    '@Suite{"flat"}',
    'fn flat() -> Array<Test>: [',
    '  test("maps", fn(): {',
    before,
    '    assert([1].flatMap(fn(n: Int) -> Array<String>: [String(n)]).length() == 1)',
    '  }),',
    ']',
  ].join('\n');
}

type Subject = (typeof programs)[number];

/** Each subject's checker, made once; throws where its program has an error. */
const checkers = new Map<Subject, Checker>();

function checkerOf(subject: Subject): Checker {
  return memo(checkers, subject, () => {
    const program = stdProgramOf(subject.files);
    const checker = checkedAfterStd(program);
    const errors = [...diagnose(program).values()].flatMap(({ diagnostics }) =>
      diagnostics.filter(isError).map(({ message }) => message),
    );
    if (errors.length > 0) {
      throw new Error(`${subject.name} doesn't compile: ${errors.join('; ')}`);
    }
    return checker;
  });
}

/** `subject` lowered, taking over what `std` kept, its Definition's hash. */
function loweredHash(subject: Subject, std: StdLowering): string {
  const checker = checkerOf(subject);
  const { program } = checker;
  const main = 'main' in subject.files ? mainOf(program, idOf('main')) : undefined;
  const definition =
    main === undefined
      ? lowerTests(checker, suitesOf(program, checker), { std })
      : lower(checker, main, { std });
  return encodeDefinition(definition).hash;
}

/** Each subject lowered with nothing kept. */
const coldHashes = new Map<Subject, string>();

describe('a program lowered after others over its std', () => {
  it('lowers to what it lowers to with nothing kept, whatever came before it', {
    timeout: slowTestTimeout,
  }, () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...programs], { minLength: 2 }),
        fc.integer({ min: 1, max: 2 }),
        (order, times) => {
          const std = new StdLowering();
          const lowered = order.flatMap((each) => Array.from({ length: times }, () => each));
          for (const subject of lowered) {
            const cold = memo(coldHashes, subject, () => loweredHash(subject, new StdLowering()));
            expect(loweredHash(subject, std)).toBe(cold);
          }
        },
      ),
      { numRuns: 6 },
    );
  });

  it("lowers a test build mocking a std generic as with nothing kept, after one that doesn't mock it", {
    timeout: slowTestTimeout,
  }, () => {
    const [unmocked, mocked] = programs.slice(-2) as [Subject, Subject];
    const std = new StdLowering();
    loweredHash(unmocked, std);
    expect(loweredHash(mocked, std)).toBe(loweredHash(mocked, new StdLowering()));
  });
});
