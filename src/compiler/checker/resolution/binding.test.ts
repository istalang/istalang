/**
 * The binding rule (§3.3) over generated parameter lists: arguments by position fill parameters in
 * order, named ones the parameter of their name in any order, a rest parameter collects what is
 * left, and every parameter left out takes its default; anything else fails with its reason.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Binding } from '../resolved-call.ts';
import { type BoundArgument, type BoundSlot, bindArguments, bindValue } from './binding.ts';

/** `count` parameters named `p0`…, the last `defaults` with a default, and maybe a rest one after. */
function slotsOf(count: number, defaults: number, rest: boolean): BoundSlot[] {
  const fixed = Array.from({ length: count }, (_, index) => ({
    name: `p${index}`,
    hasDefault: index >= count - defaults,
    isRest: false,
  }));
  return rest ? [...fixed, { name: 'rest', hasDefault: false, isRest: true }] : fixed;
}

const shapes = fc
  .tuple(fc.nat(5), fc.nat(5), fc.boolean())
  .map(([count, defaults, rest]) => ({ count, defaults: Math.min(defaults, count), rest }));

/** The binding positional arguments must give: the first `given`, then defaults, then the rest's. */
function positional(count: number, given: number, rest: number | undefined): Binding {
  const fixed: Binding[number][] = Array.from({ length: count }, (_, index) =>
    index < given ? { kind: 'argument', index } : { kind: 'default' },
  );
  if (rest === undefined) {
    return fixed;
  }
  const items = Array.from({ length: rest }, (_, index) => given + index);
  return [...fixed, { kind: 'rest', items }];
}

describe('binding arguments by position', () => {
  it('fills the parameters in order, the rest taking every argument past them', () => {
    fc.assert(
      fc.property(shapes, fc.nat(8), ({ count, defaults, rest }, extra) => {
        const required = count - defaults;
        const total = rest ? required + extra : required + (extra % (defaults + 1));
        const binding = bindArguments(
          slotsOf(count, defaults, rest),
          Array.from({ length: total }, () => ({})),
        );
        const given = Math.min(total, count);
        expect(binding).toEqual(positional(count, given, rest ? total - given : undefined));
      }),
    );
  });

  it('refuses too few arguments, and too many with no rest parameter', () => {
    fc.assert(
      fc.property(shapes, fc.boolean(), ({ count, defaults, rest }, tooMany) => {
        const required = count - defaults;
        fc.pre(tooMany ? !rest : required > 0);
        const given = tooMany ? count + 1 : required - 1;
        const binding = bindArguments(
          slotsOf(count, defaults, rest),
          Array.from({ length: given }, () => ({})),
        );
        expect(binding).toMatchObject({ kind: 'arity', minimum: required });
      }),
    );
  });
});

describe('binding named arguments', () => {
  it('binds names in any order as their positions would', () => {
    fc.assert(
      fc.property(
        shapes.chain((shape) =>
          fc.tuple(
            fc.constant(shape),
            fc.shuffledSubarray(
              Array.from({ length: shape.count }, (_, index) => index),
              { minLength: shape.count - shape.defaults },
            ),
          ),
        ),
        ([{ count, defaults, rest }, named]) => {
          fc.pre(named.every((parameter) => parameter < count));
          const required = Array.from({ length: count - defaults }, (_, index) => index);
          fc.pre(required.every((parameter) => named.includes(parameter)));
          const binding = bindArguments(
            slotsOf(count, defaults, rest),
            named.map((parameter) => ({ name: `p${parameter}` })),
          );
          const expected = Array.from({ length: count }, (_, parameter) => {
            const index = named.indexOf(parameter);
            return index === -1 ? { kind: 'default' } : { kind: 'argument', index };
          });
          expect(binding).toEqual(rest ? [...expected, { kind: 'rest', items: [] }] : expected);
        },
      ),
    );
  });

  it.each<[string, readonly BoundArgument[], unknown]>([
    ['a name no parameter has', [{}, { name: 'q' }], { kind: 'unnamed', name: 'q' }],
    [
      'a parameter given by position and by name',
      [{}, { name: 'p0' }],
      { kind: 'twice', name: 'p0' },
    ],
    ['a parameter named twice', [{ name: 'p0' }, { name: 'p0' }], { kind: 'twice', name: 'p0' }],
    ['a required parameter left out', [{ name: 'p1' }], { kind: 'missing', name: 'p0' }],
    [
      'a rest parameter given items and named',
      [{}, {}, {}, { name: 'rest' }],
      { kind: 'twice', name: 'rest' },
    ],
  ])('refuses %s', (_, callArguments, failure) => {
    expect(bindArguments(slotsOf(2, 1, true), callArguments)).toEqual(failure);
  });

  it("doesn't name a method's self", () => {
    const slots = [
      { hasDefault: false, isRest: false },
      { name: 'x', hasDefault: false, isRest: false },
    ];
    expect(bindArguments(slots, [{}, { name: 'self' }])).toEqual({ kind: 'unnamed', name: 'self' });
  });
});

describe('binding spreads', () => {
  it('collects a spread and every positional argument after it into the rest', () => {
    const binding = bindArguments(slotsOf(2, 1, true), [{}, { isSpread: true }, {}]);
    expect(binding).toEqual([
      { kind: 'argument', index: 0 },
      { kind: 'default' },
      { kind: 'rest', items: [1, 2] },
    ]);
  });

  it('refuses a spread with no rest parameter to fill', () => {
    expect(bindArguments(slotsOf(2, 1, false), [{ isSpread: true }])).toEqual({ kind: 'spread' });
  });
});

describe('binding a function named as a value', () => {
  it('takes the rest parameter as one array, and leaves trailing defaults out', () => {
    expect(bindValue(slotsOf(2, 1, true), [{}, {}, {}])).toEqual([
      { kind: 'argument', index: 0 },
      { kind: 'argument', index: 1 },
      { kind: 'argument', index: 2 },
    ]);
    expect(bindValue(slotsOf(2, 1, true), [{}])).toEqual([
      { kind: 'argument', index: 0 },
      { kind: 'default' },
      { kind: 'rest', items: [] },
    ]);
  });
});
