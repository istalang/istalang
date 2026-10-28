/**
 * Inferring type arguments (§3.5) doesn't depend on the order the arguments come in: whatever the
 * order, a call either infers the same type or reports the same thing. A type found where a value
 * must have it exactly is the parameter's own, which a convertible argument can't widen.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../compile.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

/** Arguments of different types, some fitting each other only by the implicit wrap (§2). */
const argumentTexts = ['1', 'maybe', '2', '"x"', 'none'];

function reportedCodes(argumentsText: readonly string[]): readonly number[] {
  return reportedErrors(
    [
      'fn same<T>(a: T, b: T, c: T) -> T: a',
      'async fn main():',
      '  const maybe: int? = 3',
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
  it('reports the same for every order of the same arguments', () => {
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
    'fn collect<T>(first: T, ...rest: Array<T>) -> int: rest.length()',
  ];

  it.each([
    ['a reference after an optional', 'setLast(maybe, &n)'],
    ['a reference before an optional', 'setFirst(&n, maybe)'],
    ["a spread's items after an optional", 'collect(maybe, ...ns)'],
  ])('never widens to an optional, for %s', (_case, call) => {
    const main = [
      ...declarations,
      'async fn main():',
      '  const maybe: int? = 3',
      '  const ns = [1, 2]',
      '  let n = 1',
      `  ${call}`,
    ].join('\n');
    expect(reportedErrors(main)).toEqual([checkerDiagnostics.cannotInfer.code]);
  });
});
