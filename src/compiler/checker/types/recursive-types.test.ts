/**
 * Equi-recursive identity (§3.17, docs/work/proposals/p5-equi-recursive-identity.md): over generated
 * groups of recursive bodies, two closed types have one key exactly when a reference bisimulation
 * says their unfoldings are equal, a recursive union in a union counting as its members; and
 * substituting into a closed type is closing the substituted bodies.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TypeAliasDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import { closeRecursive } from './recursive-types.ts';
import { substitute } from './substitution.ts';
import { intType, stringType, type Type } from './type.ts';
import { typeKeys } from './type-keys.ts';
import { noProgramRules } from './type-rules.test-kit.ts';
import { unionOf } from './unions.ts';

/** A body as generated: a union of a primitive and parts, or a part. */
type Spec =
  | {
      readonly kind: 'union';
      readonly primitive: 'Int' | 'String';
      readonly parts: readonly Part[];
    }
  | Part;

/** A guarded part: a tuple or a function of slots, or, unguarded in a union, an earlier body. */
type Part =
  | { readonly kind: 'tuple'; readonly elements: readonly Slot[] }
  | { readonly kind: 'function'; readonly parameter: Slot; readonly result: Slot }
  | { readonly kind: 'earlier'; readonly body: number };

/** What a guarded position holds: a body of the group, a primitive, or the open parameter. */
type Slot =
  | { readonly kind: 'body'; readonly body: number }
  | { readonly kind: 'primitive'; readonly name: 'Int' | 'String' }
  | { readonly kind: 'open' };

const aliases = [0, 1, 2, 3].map(
  (index) =>
    ({
      kind: 'TypeAliasDeclaration',
      name: { text: `A${index}` },
    }) as unknown as TypeAliasDeclaration,
);
const open = { kind: 'TypeParameter', name: { text: 'T' } } as unknown as TypeParameter;

function slotArbitrary(size: number): fc.Arbitrary<Slot> {
  return fc.oneof(
    fc.record({ kind: fc.constant('body' as const), body: fc.nat({ max: size - 1 }) }),
    fc.record({
      kind: fc.constant('primitive' as const),
      name: fc.constantFrom('Int' as const, 'String' as const),
    }),
    fc.constant({ kind: 'open' as const }),
  );
}

function partArbitrary(size: number, index: number): fc.Arbitrary<Part> {
  const slot = slotArbitrary(size);
  const guarded: fc.Arbitrary<Part> = fc.oneof(
    fc.record({
      kind: fc.constant('tuple' as const),
      elements: fc.array(slot, { minLength: 1, maxLength: 2 }),
    }),
    fc.record({ kind: fc.constant('function' as const), parameter: slot, result: slot }),
  );
  return index === 0
    ? guarded
    : fc.oneof(
        guarded,
        fc.record({ kind: fc.constant('earlier' as const), body: fc.nat({ max: index - 1 }) }),
      );
}

/** A group of one to three bodies, each referring to any body only where guarded. */
const groups: fc.Arbitrary<readonly Spec[]> = fc.integer({ min: 1, max: 3 }).chain((size) =>
  fc.tuple(
    ...Array.from({ length: size }, (_, index) =>
      fc.oneof(
        fc.record({
          kind: fc.constant('union' as const),
          primitive: fc.constantFrom('Int' as const, 'String' as const),
          parts: fc.array(partArbitrary(size, index), { minLength: 1, maxLength: 2 }),
        }),
        partArbitrary(size, 0),
      ),
    ),
  ),
);

/** The types of `specs`' bodies, each body's own use a placeholder, `T` given for the open slot. */
function bodiesOf(
  specs: readonly Spec[],
  given: Type = { kind: 'parameter', declaration: open },
): readonly Type[] {
  const slot = (each: Slot): Type => {
    switch (each.kind) {
      case 'body':
        return { kind: 'parameter', declaration: aliases[each.body] ?? open };
      case 'primitive':
        return each.name === 'Int' ? intType : stringType;
      default:
        return given;
    }
  };
  const part = (each: Part): Type => {
    switch (each.kind) {
      case 'tuple':
        return { kind: 'tuple', elements: each.elements.map(slot) };
      case 'function':
        return {
          kind: 'function',
          isSendable: false,
          isAsync: false,
          parameters: [{ type: slot(each.parameter), reference: false }],
          result: slot(each.result),
        };
      default:
        return { kind: 'parameter', declaration: aliases[each.body] ?? open };
    }
  };
  return specs.map((spec) =>
    spec.kind === 'union'
      ? unionOf(
          [spec.primitive === 'Int' ? intType : stringType, ...spec.parts.map(part)],
          noProgramRules,
        )
      : part(spec),
  );
}

function closed(bodies: readonly Type[]): readonly Type[] {
  return closeRecursive({
    bodies,
    placeholderOf: (type) =>
      type.kind === 'parameter' && type.declaration.kind === 'TypeAliasDeclaration'
        ? aliases.indexOf(type.declaration)
        : undefined,
    labels: aliases.map((declaration) => ({ kind: 'alias', declaration, arguments: [] })),
  });
}

/** A type of a group's bodies, read through its placeholders. */
interface Side {
  readonly bodies: readonly Type[];
  readonly type: Type;
}

/** `side` past its placeholders. */
function viewOf(side: Side): Type {
  let { type } = side;
  while (type.kind === 'parameter' && type.declaration.kind === 'TypeAliasDeclaration') {
    type = side.bodies[aliases.indexOf(type.declaration)] ?? type;
  }
  return type;
}

/** The members `side` is a set of: a union's, flattened through every union it holds. */
function membersOf(side: Side): readonly Side[] {
  const type = viewOf(side);
  return type.kind === 'union'
    ? type.members.flatMap((member) => membersOf({ bodies: side.bodies, type: member }))
    : [side];
}

const ids = new WeakMap<object, number>();
let numbered = 0;
const idOf = (object: object): number => {
  const known = ids.get(object);
  if (known !== undefined) {
    return known;
  }
  numbered += 1;
  ids.set(object, numbered);
  return numbered;
};

/** Whether `first` and `second` unfold alike: a greatest fixed point, every assumption its own. */
function bisimilar(first: Side, second: Side, assumed: ReadonlySet<string> = new Set()): boolean {
  const pair = `${idOf(first.bodies)}:${idOf(first.type)}/${idOf(second.bodies)}:${idOf(second.type)}`;
  if (assumed.has(pair)) {
    return true;
  }
  const inner = new Set([...assumed, pair]);
  const [a, b] = [membersOf(first), membersOf(second)];
  if (a.length > 1 || b.length > 1) {
    return (
      a.every((left) => b.some((right) => bisimilar(left, right, inner))) &&
      b.every((right) => a.some((left) => bisimilar(left, right, inner)))
    );
  }
  const [x, y] = [viewOf(first), viewOf(second)];
  const parts = (left: readonly Type[], right: readonly Type[]) =>
    left.length === right.length &&
    left.every((each, index) =>
      bisimilar(
        { bodies: first.bodies, type: each },
        { bodies: second.bodies, type: right[index] ?? each },
        inner,
      ),
    );
  if (x.kind === 'tuple' && y.kind === 'tuple') {
    return parts(x.elements, y.elements);
  }
  if (x.kind === 'function' && y.kind === 'function') {
    return parts(
      [...x.parameters.map((each) => each.type), x.result],
      [...y.parameters.map((each) => each.type), y.result],
    );
  }
  return typeKeys.typeKey(x) === typeKeys.typeKey(y) && x.kind !== 'tuple' && x.kind !== 'function';
}

/**
 * `specs` with its last body copied, the first guarded use of it pointing at the copy instead: a
 * group of the same types written as a larger graph, which closing must minimize back.
 */
function duplicated(specs: readonly Spec[]): readonly Spec[] {
  const last = specs.length - 1;
  let redirected = false;
  const slot = (each: Slot): Slot => {
    if (each.kind !== 'body' || each.body !== last || redirected) {
      return each;
    }
    redirected = true;
    return { kind: 'body', body: specs.length };
  };
  const part = (each: Part): Part => {
    switch (each.kind) {
      case 'tuple':
        return { ...each, elements: each.elements.map(slot) };
      case 'function':
        return { ...each, parameter: slot(each.parameter), result: slot(each.result) };
      default:
        return each;
    }
  };
  const copy = specs[last];
  const redirect = (spec: Spec): Spec =>
    spec.kind === 'union' ? { ...spec, parts: spec.parts.map(part) } : part(spec);
  return copy === undefined ? specs : [...specs.map(redirect), copy];
}

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
        fc.constantFrom<Type>(intType, stringType),
        fc.nat(),
        (specs, given, i) => {
          const index = i % specs.length;
          const generic = closed(bodiesOf(specs))[index];
          if (generic === undefined) {
            throw new Error('A body closed to nothing.');
          }
          const substitutedAfter = substitute(generic, new Map([[open, given]]), noProgramRules);
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
