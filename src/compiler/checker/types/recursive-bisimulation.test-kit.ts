/**
 * A reference bisimulation over the generated groups of recursive bodies
 * (recursive-types.test-kit.ts), written apart from the term graph it checks
 * (recursive-types.test.ts): a union's members flattened, then normalized by the rules of §2 as
 * stated here, not as unions.ts states them.
 */

import { aliases, shows } from './recursive-types.test-kit.ts';
import { boolType, type LiteralValue, type Type } from './type.ts';
import { typeKeys } from './type-keys.ts';

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
