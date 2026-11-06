/**
 * Generated groups of recursive bodies, written apart from the term graph they check
 * (recursive-types.test.ts), and closed as one; recursive-bisimulation.test-kit.ts relates them.
 *
 * - A body is a union of leaves and parts, or one part: a guarded one, or another body standing
 *   unguarded, before it or after it, never around a cycle, so a body may only forward to another.
 *   Leaves cover what a union normalizes: a literal beside its base, `true | false`, `Never`, and an `any Shows` member taking
 *   every primitive and literal whole, which the test rules (`showingRules`) say.
 * - The open slot is the alias's type parameter `T`; substituting it may merge members anew.
 * - A trait object part (`any Holds<…> & Pairs<…, …>`) holds slots as its traits' arguments, or
 *   a trait's own `Self`, which the trait object binds, its constraints written in either order:
 *   they are a set.
 */

import fc from 'fast-check';
import type {
  TraitDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
} from '../../../syntax/declarations.ts';
import { boolType, intType, neverType, stringType } from '../primitives.ts';
import type { Type } from '../type.ts';
import { noProgramRules } from '../type-rules.test-kit.ts';
import type { TypeRules } from '../type-rules.ts';
import { unionOf } from '../unions/unions.ts';
import { closeRecursive } from './recursive-types.ts';

/** A body as generated: a union of leaves and parts, or a part. */
export type Spec =
  | {
      readonly kind: 'union';
      readonly leaves: readonly Leaf[];
      readonly parts: readonly Part[];
    }
  | Part;

/** A member of a union holding no body: a primitive, a literal, `Never`, `any Shows` or `T`. */
type Leaf = 'Int' | 'String' | 'Bool' | 1 | 'a' | true | false | 'Never' | 'Shows' | 'open';

/**
 * A guarded part: a tuple, a function or a trait object of slots; or another body standing
 * unguarded, in a union or as the whole body, earlier or later, the unguarded ones never forming a
 * cycle.
 */
type Part =
  | { readonly kind: 'tuple'; readonly elements: readonly Slot[] }
  | { readonly kind: 'function'; readonly parameter: Slot; readonly result: Slot }
  | { readonly kind: 'traits'; readonly constraints: readonly TraitPart[] }
  | { readonly kind: 'unguarded'; readonly body: number };

/** A trait object's constraint: `Holds` takes one argument, `Pairs` two, either maybe its `Self`. */
interface TraitPart {
  readonly trait: 'holds' | 'pairs';
  readonly arguments: readonly (Slot | { readonly kind: 'self' })[];
}

/** What a guarded position holds: a body of the group, a primitive, or the open parameter. */
type Slot =
  | { readonly kind: 'body'; readonly body: number }
  | { readonly kind: 'primitive'; readonly name: 'Int' | 'String' }
  | { readonly kind: 'open' };

/** The aliases a group's bodies are written as, whose uses are the group's placeholders. */
export const aliases = [0, 1, 2, 3].map(
  (index) =>
    ({
      kind: 'TypeAliasDeclaration',
      name: { text: `A${index}` },
    }) as unknown as TypeAliasDeclaration,
);
export const open = { kind: 'TypeParameter', name: { text: 'T' } } as unknown as TypeParameter;
const traitNamed = (text: string) =>
  ({ kind: 'TraitDeclaration', name: { text } }) as unknown as TraitDeclaration;
export const shows = traitNamed('Shows');
const traits = { holds: traitNamed('Holds'), pairs: traitNamed('Pairs') };

/** The `Self` of the trait named `name`, which a trait object binds. */
export function selfOf(name: keyof typeof traits): Type {
  return { kind: 'parameter', declaration: traits[name] };
}

/** The rules of a program where `any Shows` takes every primitive whole, and so every literal. */
export const showingRules: TypeRules = {
  ...noProgramRules,
  absorbs: (target, member) =>
    target.constraints.some((constraint) => constraint.trait === shows) &&
    member.kind === 'primitive' &&
    ['Int', 'String', 'Bool'].includes(member.name),
};

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
    fc.record({
      kind: fc.constant('traits' as const),
      constraints: fc
        .shuffledSubarray(['holds', 'pairs'] as const, { minLength: 1 })
        .chain((names) =>
          fc.tuple(
            ...names.map((trait) =>
              fc.record({
                trait: fc.constant(trait),
                arguments: fc.array(fc.oneof(slot, fc.constant({ kind: 'self' as const })), {
                  minLength: trait === 'holds' ? 1 : 2,
                  maxLength: trait === 'holds' ? 1 : 2,
                }),
              }),
            ),
          ),
        ),
    }),
  );
  return index === 0
    ? guarded
    : fc.oneof(
        guarded,
        fc.record({ kind: fc.constant('unguarded' as const), body: fc.nat({ max: index - 1 }) }),
      );
}

/** `specs` numbered from the last body, so each unguarded body it names comes later instead. */
function reversedOrder(specs: readonly Spec[]): readonly Spec[] {
  const last = specs.length - 1;
  const renumbered = (body: number) => last - body;
  return specs
    .map((spec) =>
      respecified(
        spec,
        (each) => (each.kind === 'body' ? { ...each, body: renumbered(each.body) } : each),
        renumbered,
      ),
    )
    .reverse();
}

/** `spec` with each slot as `slot` gives it and each unguarded body as `unguarded` numbers it. */
function respecified(
  spec: Spec,
  slot: (each: Slot) => Slot,
  unguarded: (body: number) => number,
): Spec {
  const part = (each: Part): Part => {
    switch (each.kind) {
      case 'tuple':
        return { ...each, elements: each.elements.map(slot) };
      case 'function':
        return { ...each, parameter: slot(each.parameter), result: slot(each.result) };
      case 'traits':
        return {
          ...each,
          constraints: each.constraints.map((constraint) => ({
            ...constraint,
            arguments: constraint.arguments.map((argument) =>
              argument.kind === 'self' ? argument : slot(argument),
            ),
          })),
        };
      default:
        return { ...each, body: unguarded(each.body) };
    }
  };
  return spec.kind === 'union' ? { ...spec, parts: spec.parts.map(part) } : part(spec);
}

const leafArbitrary: fc.Arbitrary<Leaf> = fc.constantFrom<Leaf>(
  'Int',
  'String',
  'Bool',
  1,
  'a',
  true,
  false,
  'Never',
  'Shows',
  'open',
);

/**
 * A group of one to three bodies, each referring to any body where guarded, and unguarded, in a
 * union or as its whole, to a body before it or, numbered the other way, after it.
 */
export const groups: fc.Arbitrary<readonly Spec[]> = fc.integer({ min: 1, max: 3 }).chain((size) =>
  fc
    .tuple(
      fc.boolean(),
      fc.tuple(
        ...Array.from({ length: size }, (_, index) =>
          fc.oneof(
            fc.record({
              kind: fc.constant('union' as const),
              leaves: fc.array(leafArbitrary, { minLength: 1, maxLength: 3 }),
              parts: fc.array(partArbitrary(size, index), { minLength: 1, maxLength: 2 }),
            }),
            partArbitrary(size, index),
          ),
        ),
      ),
    )
    .map(([reversed, specs]) => (reversed ? reversedOrder(specs) : specs)),
);

/** The type a leaf stands for, `given` for the open one. */
function leafType(leaf: Leaf, given: Type): Type {
  switch (leaf) {
    case 'Int':
      return intType;
    case 'String':
      return stringType;
    case 'Bool':
      return boolType;
    case 'Never':
      return neverType;
    case 'Shows':
      return { kind: 'any', constraints: [{ trait: shows, arguments: [] }] };
    case 'open':
      return given;
    default:
      return { kind: 'literal', value: leaf === 1 ? 1n : leaf };
  }
}

/** The types of `specs`' bodies, each body's own use a placeholder, `T` given for the open slot. */
export function bodiesOf(
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
      case 'traits':
        return {
          kind: 'any',
          constraints: each.constraints.map((constraint) => ({
            trait: traits[constraint.trait],
            arguments: constraint.arguments.map((argument) =>
              argument.kind === 'self' ? selfOf(constraint.trait) : slot(argument),
            ),
          })),
        };
      default:
        return { kind: 'parameter', declaration: aliases[each.body] ?? open };
    }
  };
  return specs.map((spec) =>
    spec.kind === 'union'
      ? unionOf(
          [...spec.leaves.map((leaf) => leafType(leaf, given)), ...spec.parts.map(part)],
          showingRules,
        )
      : part(spec),
  );
}

/** `bodies` closed as one group, by `showingRules`. */
export function closed(bodies: readonly Type[]): readonly Type[] {
  return closeRecursive({
    bodies,
    placeholderOf: (type) =>
      type.kind === 'parameter' && type.declaration.kind === 'TypeAliasDeclaration'
        ? aliases.indexOf(type.declaration)
        : undefined,
    labels: aliases.map((declaration) => ({ kind: 'alias', declaration, arguments: [] })),
    rules: showingRules,
  });
}

/**
 * `specs` with its last body copied, the first guarded use of it pointing at the copy instead: a
 * group of the same types written as a larger graph, which closing must minimize back.
 */
export function duplicated(specs: readonly Spec[]): readonly Spec[] {
  const last = specs.length - 1;
  let redirected = false;
  const slot = (each: Slot): Slot => {
    if (each.kind !== 'body' || each.body !== last || redirected) {
      return each;
    }
    redirected = true;
    return { kind: 'body', body: specs.length };
  };
  const copy = specs[last];
  return copy === undefined
    ? specs
    : [...specs.map((spec) => respecified(spec, slot, (body) => body)), copy];
}
