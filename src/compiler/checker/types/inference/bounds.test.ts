/**
 * Two variables related, one bounding the other, hand each other their bounds (§3.5, design.md §4):
 * the lower one's lower bounds are the upper one's, the upper one's upper bounds the lower one's,
 * now and as they are added; a probe that fails leaves none of it behind.
 */

import { describe, expect, it } from 'vitest';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import { sameType } from '../identity/identity.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { intType, stringType } from '../type/primitives.ts';
import { BoundStore } from './bounds.ts';

/** A key standing for a variable, as a call's twin of a type parameter is. */
const variable = (name: string): ParameterKey =>
  ({ kind: 'TypeParameter', name }) as unknown as TypeParameter;

function store(): BoundStore {
  return new BoundStore({
    fits: (found, expected) => sameType(found, expected),
    same: sameType,
    isOpen: () => false,
    builds: () => false,
    constrain: (found, expected) => sameType(found, expected),
    equate: sameType,
  });
}

const types = (bounds: readonly { readonly type: Type }[]) => bounds.map(({ type }) => type);

describe('two related variables', () => {
  it('hand each other the bounds they had', () => {
    const [lower, upper, bounds] = [variable('T'), variable('U'), store()];
    expect(
      bounds.addLower(lower, { type: intType, fresh: false, builds: false, origin: 'argument' }),
    ).toBe(true);
    expect(bounds.addUpper(upper, { type: intType, origin: 'expected' })).toBe(true);
    expect(bounds.relate(lower, upper)).toBe(true);
    expect(types(bounds.of(upper).lower)).toEqual([intType]);
    expect(types(bounds.of(lower).upper)).toEqual([intType]);
  });

  it('hand each other the bounds added later, and a disagreement fails', () => {
    const [lower, upper, bounds] = [variable('T'), variable('U'), store()];
    expect(bounds.relate(lower, upper)).toBe(true);
    expect(bounds.addUpper(upper, { type: intType, origin: 'argument' })).toBe(true);
    expect(types(bounds.of(lower).upper)).toEqual([intType]);
    const mark = bounds.mark();
    expect(
      bounds.addLower(lower, { type: stringType, fresh: false, builds: false, origin: 'argument' }),
    ).toBe(false);
    bounds.rollback(mark);
    expect(bounds.of(lower).lower).toEqual([]);
  });

  it('are unrelated again once rolled back', () => {
    const [lower, upper, bounds] = [variable('T'), variable('U'), store()];
    const mark = bounds.mark();
    bounds.relate(lower, upper);
    bounds.rollback(mark);
    expect(bounds.addUpper(upper, { type: intType, origin: 'argument' })).toBe(true);
    expect(bounds.of(lower).upper).toEqual([]);
  });
});
