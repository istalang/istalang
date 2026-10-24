/**
 * Inferring type arguments (§3.5) doesn't depend on the order the arguments come in: whatever the
 * order, a call either infers the same type or reports the same thing.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../compile.test-kit.ts';

/** Arguments of different types, some fitting each other only by the implicit wrap (§2). */
const argumentTexts = ['1', 'maybe', '2', '"x"', 'none'];

function reportedCodes(argumentsText: readonly string[]): readonly number[] {
  const main = [
    'fn same<T>(a: T, b: T, c: T) -> T: a',
    'async fn main():',
    '  const maybe: int? = 3',
    `  const result = same(${argumentsText.join(', ')})`,
  ].join('\n');
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
