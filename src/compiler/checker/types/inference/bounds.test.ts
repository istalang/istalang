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
    takesShape: () => false,
    constrain: (found, expected) => sameType(found, expected),
    equate: sameType,
    constrainShape: () => false,
  });
}

const argument = (type: Type) => ({ type, advice: false, by: undefined }) as const;

const types = (bounds: readonly { readonly type: Type }[]) => bounds.map(({ type }) => type);

describe('two related variables', () => {
  it('hand each other the bounds they had', () => {
    const [lower, upper, bounds] = [variable('T'), variable('U'), store()];
    expect(
      bounds.addLower(lower, {
        type: intType,
        fresh: false,
        isShape: false,
        advice: false,
        by: undefined,
      }),
    ).toBe(true);
    expect(bounds.addUpper(upper, { type: intType, advice: true, by: undefined })).toBe(true);
    expect(bounds.relate(lower, upper)).toBe(true);
    expect(types(bounds.of(upper).lower)).toEqual([intType]);
    expect(types(bounds.of(lower).upper)).toEqual([intType]);
  });

  it('hand each other the bounds added later, and a disagreement fails', () => {
    const [lower, upper, bounds] = [variable('T'), variable('U'), store()];
    expect(bounds.relate(lower, upper)).toBe(true);
    expect(bounds.addUpper(upper, { type: intType, advice: false, by: undefined })).toBe(true);
    expect(types(bounds.of(lower).upper)).toEqual([intType]);
    const mark = bounds.mark();
    expect(
      bounds.addLower(lower, {
        type: stringType,
        fresh: false,
        isShape: false,
        advice: false,
        by: undefined,
      }),
    ).toBe(false);
    bounds.rollback(mark);
    expect(bounds.of(lower).lower).toEqual([]);
  });

  it('are unrelated again once rolled back', () => {
    const [lower, upper, bounds] = [variable('T'), variable('U'), store()];
    const mark = bounds.mark();
    bounds.relate(lower, upper);
    bounds.rollback(mark);
    expect(bounds.addUpper(upper, { type: intType, advice: false, by: undefined })).toBe(true);
    expect(bounds.of(lower).upper).toEqual([]);
  });
});

describe('an equality', () => {
  it('reaches the variables related to it, below as an upper bound and above as a lower one', () => {
    const [below, middle, above, bounds] = [variable('T'), variable('U'), variable('V'), store()];
    expect(bounds.relate(below, middle)).toBe(true);
    expect(bounds.relate(middle, above)).toBe(true);
    expect(bounds.addEqual(middle, argument(intType))).toBe(true);
    expect(types(bounds.of(below).upper)).toEqual([intType]);
    expect(types(bounds.of(above).lower)).toEqual([intType]);
  });

  it('a variable already holds reaches one related to it later', () => {
    const [below, middle, bounds] = [variable('T'), variable('U'), store()];
    expect(bounds.addEqual(middle, argument(intType))).toBe(true);
    expect(bounds.relate(below, middle)).toBe(true);
    expect(types(bounds.of(below).upper)).toEqual([intType]);
  });
});

describe('a variable refusing a bound', () => {
  it('takes it neither as an upper bound nor as an equality, directly or through a relation', () => {
    const [below, above, bounds] = [variable('T'), variable('U'), store()];
    bounds.admit(below, (bound) => !sameType(bound, stringType));
    expect(bounds.addUpper(below, argument(stringType))).toBe(false);
    expect(bounds.addEqual(below, argument(stringType))).toBe(false);
    expect(bounds.relate(below, above)).toBe(true);
    const mark = bounds.mark();
    expect(bounds.addUpper(above, argument(stringType))).toBe(false);
    bounds.rollback(mark);
    expect(bounds.addUpper(above, argument(intType))).toBe(true);
  });
});

describe('the store as a key', () => {
  it('is new after each change and after undoing one', () => {
    const [parameter, bounds] = [variable('T'), store()];
    const seen = [bounds.revision];
    const mark = bounds.mark();
    bounds.addUpper(parameter, argument(intType));
    seen.push(bounds.revision);
    bounds.rollback(mark);
    seen.push(bounds.revision);
    bounds.admit(parameter, () => true);
    seen.push(bounds.revision);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('stands while nothing changes', () => {
    const [parameter, bounds] = [variable('T'), store()];
    bounds.addUpper(parameter, argument(intType));
    const before = bounds.revision;
    bounds.of(parameter);
    bounds.relatedOf(parameter);
    bounds.rollback(bounds.mark());
    expect(bounds.revision).toBe(before);
  });
});
