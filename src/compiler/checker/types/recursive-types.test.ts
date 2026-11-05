/**
 * Equi-recursive identity (§3.17, docs/work/proposals/p5-equi-recursive-identity.md): over generated
 * groups of recursive bodies (recursive-types.test-kit.ts), two closed types have one key exactly
 * when a reference bisimulation says their unfoldings hold the same values, a recursive union in a
 * union counting as its members, normalized as any union's (§2); and substituting into a closed
 * type is closing the substituted bodies.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bisimilar,
  bodiesOf,
  closed,
  duplicated,
  groups,
  open,
  showingRules,
} from './recursive-types.test-kit.ts';
import { substitute } from './substitution.ts';
import { boolType, intType, stringType, type Type } from './type.ts';
import { typeKeys } from './type-keys.ts';

describe('equi-recursive identity', () => {
  it('keys two closed types alike exactly when their unfoldings are bisimilar', () => {
    fc.assert(
      fc.property(groups, groups, fc.nat(), fc.nat(), (first, second, i, j) => {
        const [left, right] = [bodiesOf(first), bodiesOf(second)];
        const [a, b] = [i % left.length, j % right.length];
        const [x, y] = [closed(left)[a], closed(right)[b]];
        if (x === undefined || y === undefined) {
          throw new Error('A body closed to nothing.');
        }
        const reference = bisimilar(
          { bodies: left, type: left[a] ?? x },
          { bodies: right, type: right[b] ?? y },
        );
        expect(typeKeys.typeKey(x) === typeKeys.typeKey(y)).toBe(reference);
      }),
      { numRuns: 300 },
    );
  });

  it('keys each body alike against the same group written as a larger graph', () => {
    fc.assert(
      fc.property(groups, fc.nat(), fc.nat(), (specs, i, j) => {
        const bodies = bodiesOf(specs);
        const again = bodiesOf(duplicated(specs));
        const [a, b] = [i % bodies.length, j % again.length];
        const x = closed(bodies)[a];
        const y = closed(again)[b];
        if (x === undefined || y === undefined) {
          throw new Error('A body closed to nothing.');
        }
        const reference = bisimilar(
          { bodies, type: bodies[a] ?? x },
          { bodies: again, type: again[b] ?? y },
        );
        expect(typeKeys.typeKey(x) === typeKeys.typeKey(y)).toBe(reference);
        expect(a !== b || (b < bodies.length && reference)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('substitutes then closes as it closes then substitutes', () => {
    fc.assert(
      fc.property(
        groups,
        fc.constantFrom<Type>(intType, stringType, boolType),
        fc.nat(),
        (specs, given, i) => {
          const index = i % specs.length;
          const generic = closed(bodiesOf(specs))[index];
          if (generic === undefined) {
            throw new Error('A body closed to nothing.');
          }
          const substitutedAfter = substitute(generic, new Map([[open, given]]), showingRules);
          const substitutedBefore = closed(bodiesOf(specs, given))[index];
          expect(substitutedBefore === undefined ? '' : typeKeys.typeKey(substitutedBefore)).toBe(
            typeKeys.typeKey(substitutedAfter),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
