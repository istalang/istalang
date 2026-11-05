/**
 * Generated groups of recursive bodies and a reference bisimulation over them, written apart from
 * the term graph they check (recursive-types.test.ts): a union's members flattened, then normalized
 * by the rules of §2 as stated here, not as unions.ts states them.
 *
 * - A body is a union of leaves and guarded parts, or one guarded part. Leaves cover what a union
 *   normalizes: a literal beside its base, `true | false`, `Never`, and an `any Shows` member taking
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
} from '../../syntax/declarations.ts';
import { closeRecursive } from './recursive-types.ts';
import { boolType, intType, type LiteralValue, neverType, stringType, type Type } from './type.ts';
import { typeKeys } from './type-keys.ts';
import { noProgramRules } from './type-rules.test-kit.ts';
import type { TypeRules } from './type-rules.ts';
import { unionOf } from './unions.ts';

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
 * A guarded part: a tuple, a function or a trait object of slots, or, unguarded in a union, an
 * earlier body.
 */
type Part =
  | { readonly kind: 'tuple'; readonly elements: readonly Slot[] }
  | { readonly kind: 'function'; readonly parameter: Slot; readonly result: Slot }
  | { readonly kind: 'traits'; readonly constraints: readonly TraitPart[] }
  | { readonly kind: 'earlier'; readonly body: number };

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

const aliases = [0, 1, 2, 3].map(
  (index) =>
    ({
      kind: 'TypeAliasDeclaration',
      name: { text: `A${index}` },
    }) as unknown as TypeAliasDeclaration,
);
export const open = { kind: 'TypeParameter', name: { text: 'T' } } as unknown as TypeParameter;
const traitNamed = (text: string) =>
  ({ kind: 'TraitDeclaration', name: { text } }) as unknown as TraitDeclaration;
const shows = traitNamed('Shows');
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
        fc.record({ kind: fc.constant('earlier' as const), body: fc.nat({ max: index - 1 }) }),
      );
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

/** A group of one to three bodies, each referring to any body only where guarded. */
export const groups: fc.Arbitrary<readonly Spec[]> = fc.integer({ min: 1, max: 3 }).chain((size) =>
  fc.tuple(
    ...Array.from({ length: size }, (_, index) =>
      fc.oneof(
        fc.record({
          kind: fc.constant('union' as const),
          leaves: fc.array(leafArbitrary, { minLength: 1, maxLength: 3 }),
          parts: fc.array(partArbitrary(size, index), { minLength: 1, maxLength: 2 }),
        }),
        partArbitrary(size, 0),
      ),
    ),
  ),
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

/** A type of a group's bodies, read through its placeholders. */
export interface Side {
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
function flatMembersOf(side: Side): readonly Side[] {
  const type = viewOf(side);
  return type.kind === 'union'
    ? type.members.flatMap((member) => flatMembersOf({ bodies: side.bodies, type: member }))
    : [side];
}

/**
 * The members `side` holds as values (§2): `Never` holds none; `any Shows` holds every primitive
 * and literal; a primitive holds its literals, and `true` and `false` together are `Bool`.
 */
function membersOf(side: Side): readonly Side[] {
  const flat = flatMembersOf(side).filter((member) => {
    const type = viewOf(member);
    return !(type.kind === 'primitive' && type.name === 'Never');
  });
  const views = flat.map(viewOf);
  if (views.some((type) => type.kind === 'any' && type.constraints[0]?.trait === shows)) {
    return flat.filter((_, index) => {
      const type = views[index];
      return type?.kind !== 'primitive' && type?.kind !== 'literal';
    });
  }
  const bases = new Set<string>(
    views.flatMap((type) => (type.kind === 'primitive' ? [type.name] : [])),
  );
  const literals = new Set(views.flatMap((type) => (type.kind === 'literal' ? [type.value] : [])));
  const bool = !bases.has('Bool') && literals.has(true) && literals.has(false);
  const kept = flat.filter((_, index) => {
    const type = views[index];
    if (type?.kind !== 'literal') {
      return true;
    }
    return !(bases.has(literalBaseName(type.value)) || (bool && typeof type.value === 'boolean'));
  });
  return bool ? [...kept, { bodies: side.bodies, type: boolType }] : kept;
}

/** The name of the primitive a literal of `value` belongs to. */
function literalBaseName(value: LiteralValue): string {
  switch (typeof value) {
    case 'bigint':
      return 'Int';
    case 'string':
      return 'String';
    default:
      return 'Bool';
  }
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
export function bisimilar(
  first: Side,
  second: Side,
  assumed: ReadonlySet<string> = new Set(),
): boolean {
  const pair = `${idOf(first.bodies)}:${idOf(first.type)}/${idOf(second.bodies)}:${idOf(second.type)}`;
  if (assumed.has(pair)) {
    return true;
  }
  const inner = new Set([...assumed, pair]);
  const [a, b] = [membersOf(first), membersOf(second)];
  const [left, right] = [a[0], b[0]];
  if (a.length !== 1 || b.length !== 1 || left === undefined || right === undefined) {
    return (
      a.every((each) => b.some((other) => bisimilar(each, other, inner))) &&
      b.every((other) => a.some((each) => bisimilar(each, other, inner)))
    );
  }
  return sameNode(left, right, inner);
}

/** Whether two sides holding one member each are alike at their top, their parts bisimilar. */
function sameNode(first: Side, second: Side, inner: ReadonlySet<string>): boolean {
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
  if (x.kind === 'any' && y.kind === 'any') {
    return (
      x.constraints.length === y.constraints.length &&
      x.constraints.every((constraint) => {
        const other = y.constraints.find((each) => each.trait === constraint.trait);
        return other !== undefined && parts(constraint.arguments, other.arguments);
      })
    );
  }
  const composite = (type: Type) => ['tuple', 'function', 'any'].includes(type.kind);
  return typeKeys.typeKey(x) === typeKeys.typeKey(y) && !composite(x);
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
        return each;
    }
  };
  const copy = specs[last];
  const redirect = (spec: Spec): Spec =>
    spec.kind === 'union' ? { ...spec, parts: spec.parts.map(part) } : part(spec);
  return copy === undefined ? specs : [...specs.map(redirect), copy];
}
